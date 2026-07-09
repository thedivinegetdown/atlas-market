import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_DATA_QUALITY_EVALUATED_EVENT,
  createDataQualityReadinessEngine,
  evaluateDataQualityReadiness,
} from './dataQualityReadinessEngine.js'

const baseInput = {
  marketDataAdapterHealth: {
    eventType: 'marketData.adapter.checked',
    health: { status: 'healthy', available: true, stale: false },
  },
  marketIntelligence: { eventType: 'research.marketIntelligence.evaluated' },
  researchSignalScore: { eventType: 'research.signalScore.evaluated' },
  researchDecisionContext: { eventType: 'research.decisionContext.prepared' },
  multiTimeframeResearchContext: { eventType: 'research.multiTimeframeContext.evaluated' },
  strategyBlueprintValidation: { eventType: 'strategy.blueprint.validated', validationStatus: 'valid' },
  strategyRuleEvaluation: { eventType: 'strategy.rules.evaluated' },
  strategySignalComposition: { eventType: 'strategy.signal.composed' },
  strategyBacktestInput: { eventType: 'strategy.backtestInput.prepared', readinessStatus: 'ready' },
  portfolioAnalytics: { eventType: 'portfolio.analytics.evaluated', diversification: { label: 'balanced' } },
  portfolioCorrelation: { eventType: 'portfolio.correlation.evaluated' },
  portfolioFactorExposure: { eventType: 'portfolio.factorExposure.evaluated' },
  eventObservability: {
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
    missingEventDetection: { missingCount: 0 },
    eventFreshnessCheck: { staleCount: 0 },
    duplicateEventDetection: { duplicateCount: 0 },
  },
  productionMonitoringPlan: { eventType: 'system.monitoringPlan.generated' },
}

describe('data quality readiness engine', () => {
  it('evaluates ready data quality without mutating data', () => {
    const result = evaluateDataQualityReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T01:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_DATA_QUALITY_EVALUATED_EVENT)
    expect(result.dataQualityStatus).toBe('ready')
    expect(result.marketDataQualitySummary.status).toBe('ready')
    expect(result.researchDataQualitySummary.status).toBe('ready')
    expect(result.strategyDataQualitySummary.status).toBe('ready')
    expect(result.portfolioAnalyticsDataQualitySummary.status).toBe('ready')
    expect(result.eventDataQualitySummary.status).toBe('ready')
    expect(result.missingStaleIncompleteDataSummary.missingDataCount).toBe(0)
    expect(result.userDataMutated).toBe(false)
    expect(result.databaseMigrationAdded).toBe(false)
    expect(result.liveOrders).toBe(false)
  })

  it('blocks data quality when required event data is missing', () => {
    const result = evaluateDataQualityReadiness({
      ...baseInput,
      eventObservability: {
        ...baseInput.eventObservability,
        observabilityStatus: 'degraded',
        missingEventDetection: { missingCount: 2 },
      },
    }, { emitEvent: false })

    expect(result.dataQualityStatus).toBe('blocked')
    expect(result.eventDataQualitySummary.missingCount).toBe(2)
    expect(result.missingStaleIncompleteDataSummary.affectedDomains).toContain('events')
  })

  it('emits data quality evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_DATA_QUALITY_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createDataQualityReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
