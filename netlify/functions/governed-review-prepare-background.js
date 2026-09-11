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
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000
const STALE_THRESHOLD_MS = 5 * 60 * 1000

function createClaimToken() {
  return `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function getPreparationStore(repository) {
  return repository.getStore(PREPARATION_STORE)
}

async function savePreparation(repository, preparation) {
  const store = repository.getStore(PREPARATION_STORE)
  if (!store) {
    throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
  }
  const result = await store.upsertScoped(preparation.id, preparation, preparation.tenantContext)
  return result
}

async function claimPreparation(repository, preparationId, tenantContext) {
  const store = repository.getStore(PREPARATION_STORE)
  if (!store) return { claimed: false, reason: 'store_unavailable' }

  const record = await store.getScoped(preparationId, tenantContext)
  if (!record) return { claimed: false, reason: 'not_found' }

  const prep = record.payload ?? record
  const nowIso = new Date().toISOString()
  const STALE_THRESHOLD_MS = 5 * 60 * 1000

  if (prep.status === 'completed') return { claimed: false, reason: 'already_completed', preparation: prep }
  if (prep.status === 'expired') return { claimed: false, reason: 'expired', preparation: prep }
  if (prep.status === 'failed') return { claimed: false, reason: 'failed', preparation: prep }

  if (prep.status === 'running') {
    const updatedAt = prep.updatedAt ? new Date(prep.updatedAt).getTime() : 0
    if (Date.now() - updatedAt > 5 * 60 * 1000) {
      const newAttempt = (prep.attempt ?? 0) + 1
      const newClaimToken = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
      try {
        const updated = await store.conditionalUpdateScoped(
          preparationId,
          { status: 'running', attempt: newAttempt, claimToken: newClaimToken, updatedAt: new Date().toISOString() },
          { claimToken: prep.claimToken, status: 'running' },
          tenantContext
        )
        if (updated) {
          return { claimed: true, preparation: { ...prep, status: 'running', attempt: newAttempt, claimToken: newClaimToken, updatedAt: new Date().toISOString() } }
        }
      } catch (err) {
        return { claimed: false, reason: 'claimed_by_other', preparation: prep }
      }
      return { claimed: false, reason: 'claimed_by_other', preparation: prep }
    }

    const newAttempt = (prep.attempt ?? 0) + 1
    const newClaimToken = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
    try {
      const updated = await store.conditionalUpdateScoped(
        preparationId,
        { status: 'running', attempt: newAttempt, claimToken: newClaimToken, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { claimToken: prep.claimToken, status: 'pending' },
        tenantContext
      )
      if (updated) {
        return { claimed: true, preparation: { ...prep, status: 'running', attempt: newAttempt, claimToken: newClaimToken, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
      }
    } catch (err) {
      return { claimed: false, reason: 'claimed_by_other', preparation: prep }
    }
    return { claimed: false, reason: 'claimed_by_other', preparation: prep }
  }

async function savePreparation(repository, preparation) {
  const store = repository.getStore(PREPARATION_STORE)
  if (!store) throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
  return store.upsertScoped(preparation.id, preparation, preparation.tenantContext)
}

const GOVERNED_STRATEGIES = Object.freeze([
  { id: 'breakout-momentum-v1', name: 'Breakout Momentum', experiment: 'BREAKOUT.1', signalBuilder: buildBreakoutMomentumSignal },
  { id: 'range-mean-reversion-v1', name: 'Range Mean Reversion', experiment: 'RANGE.1', signalBuilder: buildRangeMeanReversionSignal },
  { id: 'volatility-expansion-v1', name: 'Volatility Expansion', experiment: 'VOL.1', signalBuilder: buildVolatilityExpansionSignal },
])

const PREPARATION_STORE = 'governedReviewPreparations'
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000
const BREAKOUT_OBSERVATION_UNIVERSE = Object.freeze(['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'])

async function runGovernedPreparation(preparation, context) {
  const { workspaceDataService, creditBudget, now } = context

  try {
    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'running',
      startedAt: now().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const packet = await workspaceDataService.buildMarketEvidencePacket(BREAKOUT_OBSERVATION_UNIVERSE, { now: now() })

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

          if (!signal || signal.suitabilityStatus === 'REJECTED' || signal.suitabilityStatus === 'INSUFFICIENT_DATA' || signal.suitabilityStatus === 'STALE') continue

          const suitability = selectStrategiesForRegime({
            regime: evidence.regime?.classification ?? {},
            strategies: EXISTING_ADAPTIVE_STRATEGY_RECORDS,
            context: { symbol, timeframe: '1D' },
          }, { logger: serverLogger })

          const strategySuitability = suitability.strategies.find(s => s.strategyId === strategy.id)
          if (!strategySuitability || strategySuitability.decision === 'DISABLED') continue

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

    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'completed',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      queueItems,
      providerCalls: packet.providerCalls,
    })

  } catch (err) {
    serverLogger.error('governed preparation failed', { preparationId: preparation.id, error: err?.message })
    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'failed',
      failedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: err?.message ?? 'Preparation failed',
    })
  }
}

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { body, repository, tenantContext, requestId } = context
  const { preparationId } = body ?? {}

  if (!preparationId) {
    return { ok: false, error: { code: 'validation_error', message: 'preparationId is required' } }
  }

  serverLogger.info('governed review background worker start', { preparationId, requestId })

  try {
    const claimResult = await claimPreparation(repository, preparationId, tenantContext)
    serverLogger.info('governed review background claim result', { preparationId, claimed: claimResult.claimed, reason: claimResult.reason })

    if (!claimResult.claimed) {
      return { ok: true, data: { preparationId, claimed: false, reason: claimResult.reason } }
    }

    const workspaceDataService = createWorkspaceDataService()
    await runGovernedPreparation({ ...claimResult.preparation, repository }, {
      workspaceDataService,
      creditBudget: { dailyLimit: 800, minuteLimit: 6 },
      now: () => new Date(),
    })

    serverLogger.info('governed review background completed', { preparationId })
    return { ok: true, data: { preparationId, status: 'completed' } }
  } catch (err) {
    serverLogger.error('governed review background error', { preparationId, error: err?.message })
    return { ok: false, error: { code: 'background_failed', message: 'Background preparation failed', details: err?.message } }
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-prepare-background',
})