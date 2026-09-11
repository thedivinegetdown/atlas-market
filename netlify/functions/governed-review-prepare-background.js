import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { createWorkspaceDataService } from '../../../lib/workspace/workspaceDataService.js'
import { createCreditBudget } from '../../../lib/market/creditBudget.js'
import { BREAKOUT_OBSERVATION_UNIVERSE } from '../../../lib/opportunities/forwardTest/forwardObservationEngine.js'
import { buildBreakoutMomentumSignal } from '../../../lib/strategies/breakout/breakoutMomentumSignal.js'
import { buildRangeMeanReversionSignal } from '../../../lib/strategies/range/rangeMeanReversionSignal.js'
import { buildVolatilityExpansionSignal } from '../../../lib/strategies/volatility/volatilityExpansionSignal.js'
import { scoreTradeQuality } from '../../../lib/opportunities/quality/index.js'
import { selectStrategiesForRegime } from '../../../lib/strategies/adaptive/index.js'
import { EXISTING_ADAPTIVE_STRATEGY_RECORDS } from '../../../lib/strategies/adaptive/index.js'
import { serverLogger } from '../../../lib/logging/logger.js'

const GOVERNED_STRATEGIES = Object.freeze([
  { id: 'breakout-momentum-v1', name: 'Breakout Momentum', experiment: 'BREAKOUT.1', signalBuilder: buildBreakoutMomentumSignal },
  { id: 'range-mean-reversion-v1', name: 'Range Mean Reversion', experiment: 'RANGE.1', signalBuilder: buildRangeMeanReversionSignal },
  { id: 'volatility-expansion-v1', name: 'Volatility Expansion', experiment: 'VOL.1', signalBuilder: buildVolatilityExpansionSignal },
])

const PREPARATION_STORE = 'governedReviewPreparations'
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

function createPreparationId() {
  return `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function createClaimToken() {
  return `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function getPreparationStore(repository) {
  return repository.getStore(PREPARATION_STORE)
}

async function savePreparation(repository, preparation) {
  const store = getPreparationStore(repository)
  if (!store) {
    throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
  }
  const result = await store.upsertScoped(preparation.id, preparation, preparation.tenantContext)
  return result
}

/**
 * Atomically create or reuse preparation for this org/user.
 * Uses upsert with ON CONFLICT on the unique active index.
 * Returns { preparation, created, existingId }
 */
async function createOrReusePreparation(repository, organizationId, userId, tenantContext, now) {
  const preparationId = `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const claimToken = createClaimToken()
  const expiresAt = new Date(Date.now() + PREPARATION_TTL_MS).toISOString()
  const nowIso = now().toISOString()

  const preparation = {
    id: preparationId,
    organizationId,
    userId,
    tenantContext,
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt,
    attempt: 0,
    claimToken,
    universe: BREAKOUT_OBSERVATION_UNIVERSE,
    strategies: GOVERNED_STRATEGIES.map(s => s.id),
  }

  const store = getPreparationStore(repository)
  if (!store) {
    throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
  }

  // Try to insert new preparation
  // If unique active constraint violated, fetch the existing active preparation
  try {
    await store.upsertScoped(preparationId, preparation, tenantContext)
    return { preparation, created: true, existingId: null }
  } catch (err) {
    // Check if it's a unique constraint violation on active preparation
    if (err?.message?.includes('idx_atlas_governed_review_preparations_active_unique') ||
        err?.message?.includes('unique constraint') ||
        err?.code === '23505') {
      // Fetch existing active preparation
      const existing = await findActivePreparation(repository, organizationId, userId)
      if (existing) {
        return { preparation: existing, created: false, existingId: existing.id }
      }
    }
    throw err
  }
}

/**
 * Find active (pending/running, non-expired) preparation for org/user
 */
async function findActivePreparation(repository, organizationId, userId) {
  const store = getPreparationStore(repository)
  if (!store) return null
  const records = await store.listScoped({
    organizationId,
    userId,
    limit: 10,
  })
  const now = Date.now()
  for (const record of records) {
    const p = record.payload ?? record
    const expiresAt = p.expiresAt ? new Date(p.expiresAt).getTime() : 0
    if (expiresAt && expiresAt <= now) continue
    if (p.status === 'pending' || p.status === 'running') {
      return p
    }
  }
  return null
}

/**
 * Atomically claim a pending preparation for execution.
 * Uses optimistic locking with attempt counter and claim_token.
 * Returns { claimed: true, preparation } or { claimed: false, reason, preparation? }
 */
async function claimPreparation(repository, preparationId, tenantContext) {
  const store = getPreparationStore(repository)
  if (!store) return { claimed: false, reason: 'store_unavailable' }

  const record = await store.getScoped(preparationId, tenantContext)
  if (!record) return { claimed: false, reason: 'not_found' }

  const prep = record.payload ?? record
  const nowIso = new Date().toISOString()

  // Already completed/failed/expired - no claim
  if (prep.status === 'completed') return { claimed: false, reason: 'already_completed', preparation: prep }
  if (prep.status === 'expired') return { claimed: false, reason: 'expired', preparation: prep }
  if (prep.status === 'failed') return { claimed: false, reason: 'failed', preparation: prep }

  // Already running - check if stale
  if (prep.status === 'running') {
    const updatedAt = prep.updatedAt ? new Date(prep.updatedAt).getTime() : 0
    if (Date.now() - updatedAt > STALE_THRESHOLD_MS) {
      // Stale - attempt atomic recovery with incremented attempt
      const newAttempt = (prep.attempt ?? 0) + 1
      const newClaimToken = createClaimToken()
      try {
        // Atomic: only update if claim_token still matches and status is still running
        const updated = await store.conditionalUpdateScoped(
          preparationId,
          {
            status: 'running',
            attempt: newAttempt,
            claimToken: newClaimToken,
            updatedAt: new Date().toISOString(),
          },
          { claimToken: prep.claimToken, status: 'running' },
          tenantContext
        )
        if (updated) {
          return { claimed: true, preparation: { ...prep, status: 'running', attempt: newAttempt, claimToken: newClaimToken, updatedAt: new Date().toISOString() } }
        }
      } catch (err) {
        // Conditional update failed - another worker got it
        return { claimed: false, reason: 'claimed_by_other', preparation: prep }
      }
      return { claimed: false, reason: 'claimed_by_other', preparation: prep }
    }

    // Pending - attempt atomic claim
    const newAttempt = (prep.attempt ?? 0) + 1
    const newClaimToken = createClaimToken()
    try {
      // Atomic: only update if claim_token still matches and status is pending
      const updated = await store.conditionalUpdateScoped(
        preparationId,
        {
          status: 'running',
          attempt: newAttempt,
          claimToken: newClaimToken,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { claimToken: prep.claimToken, status: 'pending' },
        tenantContext
      )
      if (updated) {
        return { claimed: true, preparation: { ...prep, status: 'running', attempt: newAttempt, claimToken: newClaimToken, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
      }
    } catch (err) {
      // Conditional update failed
      return { claimed: false, reason: 'claimed_by_other', preparation: prep }
    }
    return { claimed: false, reason: 'claimed_by_other', preparation: prep }
}

async function runGovernedPreparation(preparation, context) {
  const { workspaceDataService, creditBudget, now } = context

  try {
    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'running',
      startedAt: now().toISOString(),
      updatedAt: now().toISOString(),
    })

    // Build ONE shared market evidence packet for the governed universe
    const packet = await workspaceDataService.buildMarketEvidencePacket(BREAKOUT_OBSERVATION_UNIVERSE, { now: now() })

    // Evaluate all three governed strategies for each symbol
    const queueItems = []

    for (const symbol of packet.universe) {
      const evidence = packet.symbols[symbol]
      if (!evidence || !evidence.quote || !evidence.candles.length) continue

      for (const strategy of GOVERNED_STRATEGIES) {
        try {
          const signal = strategy.signalBuilder({
            symbol,
            currentPrice: evidence.quote.price,
            candles: evidence.candles,
            indicatorBundle: {
              indicators: evidence.indicators,
              coverage: evidence.indicatorCoverage,
              provenance: evidence.indicatorProvenance,
            },
            regime: evidence.regime,
            marketContext: { participation: { status: 'MIXED' }, selectedCandidateContext: { alignmentStatus: 'UNAVAILABLE' } },
            evidenceFreshness: evidence.regime?.freshness ?? 'FRESH',
            generatedAt: packet.asOf,
          })

          if (!signal || signal.suitabilityStatus === 'REJECTED' || signal.suitabilityStatus === 'INSUFFICIENT_DATA' || signal.suitabilityStatus === 'STALE') {
            continue
          }

          // Check strategy suitability for current regime
          const suitability = selectStrategiesForRegime({
            regime: evidence.regime?.classification ?? {},
            strategies: EXISTING_ADAPTIVE_STRATEGY_RECORDS,
            context: { symbol, timeframe: '1D' },
          }, { logger: serverLogger })

          const strategySuitability = suitability.strategies.find(s => s.strategyId === strategy.id)
          if (!strategySuitability || strategySuitability.decision === 'DISABLED') {
            continue
          }

          // Build TQ candidate using packet evidence
          const candidate = {
            symbol,
            strategyId: strategy.id,
            direction: signal.side === 'SHORT' ? 'bearish' : 'bullish',
            deterministicMetrics: {
              trendScore: signal.trendScore ?? null,
              momentumScore: signal.momentumScore ?? null,
              relativeStrength: evidence.indicators?.relativeStrengthPct ?? null,
              relativeVolume: evidence.indicators?.relativeVolume ?? null,
              atrPercentile: evidence.indicators?.atrPercentile ?? null,
            },
            liquiditySummary: { status: 'observed' },
            riskSummary: { rewardRiskRatio: 2.0 },
            [strategy.id === 'breakout-momentum-v1' ? 'breakoutSignal' :
              strategy.id === 'range-mean-reversion-v1' ? 'rangeMeanReversionSignal' :
              'volatilityExpansionSignal']: signal,
          }

          const quality = scoreTradeQuality({ candidate, regime: evidence.regime?.classification ?? {}, strategySuitability: suitability }, { logger: serverLogger })

          queueItems.push({
            symbol,
            strategyId: strategy.id,
            strategyName: strategy.name,
            experiment: strategy.experiment,
            suitabilityStatus: signal.suitabilityStatus,
            quality: {
              score: quality.score,
              band: quality.band,
              confidence: quality.confidence,
              evidenceCoverage: quality.evidenceCoverage,
              evidenceFingerprint: quality.evidenceFingerprint,
            },
            signal: {
              side: signal.side,
              suitabilityStatus: signal.suitabilityStatus,
              strategyFingerprint: signal.strategyFingerprint,
              currentPrice: signal.currentPrice,
              prior20High: signal.prior20High,
              prior20Low: signal.prior20Low,
              SMA20: signal.SMA20,
              SMA50: signal.SMA50,
              SMA200: signal.SMA200,
              ADX: signal.ADX,
              RSI: signal.RSI,
              ATR: signal.ATR,
              ATRPercentile: signal.ATRPercentile,
              relativeVolume: signal.relativeVolume,
              relativeStrengthPct: signal.relativeStrengthPct,
            },
            regime: {
              classification: evidence.regime?.classification ?? {},
              freshness: evidence.regime?.freshness ?? 'FRESH',
              inputCoverage: evidence.regime?.inputCoverage ?? {},
            },
            provenance: {
              quote: evidence.provenance?.quote ?? null,
              candles: evidence.provenance?.candles ?? null,
              indicators: evidence.provenance?.indicators ?? null,
              regime: evidence.provenance?.regime ?? null,
            },
            missingInputs: quality.missingInputs ?? [],
            blockingReasons: quality.blockingReasons ?? [],
          })
        } catch (err) {
          serverLogger.warn('governed strategy evaluation failed', { symbol, strategy: strategy.id, error: err?.message })
        }
      }
    }

    // Save completed preparation
    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'completed',
      completedAt: now().toISOString(),
      updatedAt: new Date().toISOString(),
      queueItems,
      providerCalls: packet.providerCalls,
    })

  } catch (err) {
    serverLogger.error('governed preparation failed', { preparationId: preparation.id, error: err?.message })
    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'failed',
      failedAt: now().toISOString(),
      updatedAt: new Date().toISOString(),
      error: err?.message ?? 'Preparation failed',
    })
  }
}

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { organizationId, user, tenantContext, requestId } = context
  const repository = context.repository
  const now = () => new Date()

  // Atomically create or reuse preparation (deduplication)
  const { preparation, created, existingId } = await createOrReusePreparation(repository, organizationId, user.id, tenantContext, now)

  if (!created) {
    return {
      ok: true,
      data: {
        preparationId: existingId,
        status: preparation.status,
        message: 'Governed review preparation already in progress',
        reused: true,
      },
    }
  }

  // Claim the preparation atomically
  const claimResult = await claimPreparation(repository, preparation.id, tenantContext)
  if (!claimResult.claimed) {
    // Should not happen for newly created, but handle gracefully
    if (claimResult.reason === 'already_completed') {
      return {
        ok: true,
        data: {
          preparationId: preparation.id,
          status: 'completed',
          message: 'Governed review preparation already completed',
        },
      }
    }
    return {
      ok: true,
      data: {
        preparationId: preparation.id,
        status: preparation.status,
        message: `Could not claim preparation: ${claimResult.reason}`,
      },
    }
  }

  // Start background preparation (fire and forget with claimed preparation)
  const workspaceDataService = createWorkspaceDataService()
  runGovernedPreparation({ ...claimResult.preparation, repository }, {
    workspaceDataService,
    creditBudget: createCreditBudget({ dailyLimit: 800, minuteLimit: 6 }),
    now,
  }).catch(err => serverLogger.error('governed preparation background error', { preparationId: preparation.id, error: err?.message }))

  return {
    ok: true,
    data: {
      preparationId: preparation.id,
      status: 'pending',
      message: 'Governed review preparation started',
    },
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-prepare',
})