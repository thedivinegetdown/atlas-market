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

function createPreparationId() {
  return `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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

async function getPreparation(repository, id, tenantContext) {
  const store = getPreparationStore(repository)
  if (!store) return null
  return store.getScoped(id, tenantContext)
}

async function runGovernedPreparation(preparation, context) {
  const { workspaceDataService, creditBudget, now } = context

  try {
    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'running',
      startedAt: now().toISOString(),
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
      queueItems,
      providerCalls: packet.providerCalls,
    })

  } catch (err) {
    serverLogger.error('governed preparation failed', { preparationId: preparation.id, error: err?.message })
    await savePreparation(preparation.repository, {
      ...preparation,
      status: 'failed',
      failedAt: now().toISOString(),
      error: err?.message ?? 'Preparation failed',
    })
  }
}

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { organizationId, user, tenantContext, requestId } = context
  const repository = context.repository

  const preparationId = createPreparationId()
  const creditBudget = createCreditBudget({ dailyLimit: 800, minuteLimit: 6 })

  const preparation = {
    id: preparationId,
    organizationId,
    userId: user.id,
    tenantContext,
    status: 'pending',
    createdAt: new Date().toISOString(),
    universe: BREAKOUT_OBSERVATION_UNIVERSE,
    strategies: GOVERNED_STRATEGIES.map(s => s.id),
  }

  await savePreparation(repository, preparation)

  // Start background preparation (fire and forget)
  const workspaceDataService = createWorkspaceDataService()
  runGovernedPreparation({ ...preparation, repository }, {
    workspaceDataService,
    creditBudget,
    now: () => new Date(),
  }).catch(err => serverLogger.error('governed preparation background error', { preparationId, error: err?.message }))

  return {
    ok: true,
    data: {
      preparationId,
      status: 'pending',
      message: 'Governed review preparation started',
    },
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-prepare',
})