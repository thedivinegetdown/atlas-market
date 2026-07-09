import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_DATA_LINEAGE_EVALUATED_EVENT,
  createDataLineageEngine,
  evaluateDataLineage,
} from './dataLineageEngine.js'

const baseInput = {
  marketDataAdapterHealth: {
    eventType: 'marketData.adapter.checked',
    health: { status: 'healthy', provider: 'mock-market-data' },
  },
  marketIntelligence: { eventType: 'research.marketIntelligence.evaluated' },
  researchSignalScore: { eventType: 'research.signalScore.evaluated' },
  researchDecisionContext: { eventType: 'research.decisionContext.prepared' },
  multiTimeframeResearchContext: { eventType: 'research.multiTimeframeContext.evaluated' },
  strategyBlueprintValidation: { eventType: 'strategy.blueprint.validated', validationStatus: 'valid' },
  strategyBacktestPerformance: { eventType: 'strategy.backtestPerformance.evaluated', analyticsStatus: 'ready' },
  portfolioAnalytics: { eventType: 'portfolio.analytics.evaluated' },
  workspacePersistence: { eventType: 'workspace.persistence.prepared', persistenceStatus: 'ready' },
  eventObservability: {
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
    eventFamilyGrouping: [{ family: 'research' }, { family: 'strategy' }],
  },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
    normalizedAuditRecords: [{ id: 'audit-1' }],
    eventChainReferences: [
      'marketData.adapter.checked',
      'research.marketIntelligence.evaluated',
      'system.dataQuality.evaluated',
    ],
  },
  productionDeploymentReadiness: { eventType: 'system.deploymentReadiness.evaluated', deploymentReadinessStatus: 'ready' },
  productionSecurityReadiness: { eventType: 'system.securityReadiness.evaluated', securityReadinessStatus: 'ready' },
  productionMonitoringPlan: { eventType: 'system.monitoringPlan.generated', monitoringReadinessStatus: 'ready' },
  dataQualityReadiness: { eventType: 'system.dataQuality.evaluated', dataQualityStatus: 'ready' },
}

describe('data lineage engine', () => {
  it('evaluates lineage and provenance without broker execution', () => {
    const result = evaluateDataLineage(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T01:05:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_DATA_LINEAGE_EVALUATED_EVENT)
    expect(result.inputSourceLineageSummary).toHaveLength(6)
    expect(result.engineOutputLineageSummary).toHaveLength(6)
    expect(result.researchMockDataProvenanceSummary.mockInputsAllowed).toBe(true)
    expect(result.researchMockDataProvenanceSummary.paidApiRequired).toBe(false)
    expect(result.adapterProvenanceSummary.brokerExecution).toBe(false)
    expect(result.auditLineageCompatibility.compatible).toBe(true)
    expect(result.databaseMigrationAdded).toBe(false)
    expect(result.userDataMutated).toBe(false)
  })

  it('returns invalid lineage when audit integrity is invalid', () => {
    const result = evaluateDataLineage({
      ...baseInput,
      enterpriseAuditTrail: {
        ...baseInput.enterpriseAuditTrail,
        auditIntegrityStatus: { status: 'invalid' },
      },
    }, { emitEvent: false })

    expect(result.lineageStatus).toBe('invalid')
    expect(result.auditLineageCompatibility.status).toBe('invalid')
  })

  it('emits data lineage evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_DATA_LINEAGE_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createDataLineageEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
