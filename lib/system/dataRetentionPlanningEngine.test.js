import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_DATA_RETENTION_PLANNED_EVENT,
  createDataRetentionPlanningEngine,
  planDataRetention,
} from './dataRetentionPlanningEngine.js'

const baseInput = {
  eventObservability: { eventType: 'system.events.observed', observabilityStatus: 'healthy' },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
  },
  workspacePersistence: {
    eventType: 'workspace.persistence.prepared',
    persistenceStatus: 'ready',
    futurePostgresPersistenceInterface: { implemented: true },
  },
  strategyBacktestReport: {
    eventType: 'strategy.backtestReport.generated',
    releaseResearchRecommendation: 'approve',
  },
  marketIntelligence: { eventType: 'research.marketIntelligence.evaluated' },
  researchDecisionContext: { eventType: 'research.decisionContext.prepared' },
  dataQualityReadiness: { eventType: 'system.dataQuality.evaluated', dataQualityStatus: 'ready' },
  dataLineage: { eventType: 'system.dataLineage.evaluated', lineageStatus: 'valid' },
  productionDeploymentReadiness: { eventType: 'system.deploymentReadiness.evaluated' },
  productionSecurityReadiness: { eventType: 'system.securityReadiness.evaluated' },
  productionMonitoringPlan: { eventType: 'system.monitoringPlan.generated' },
}

describe('data retention planning engine', () => {
  it('plans retention without migrations, deletions, or data mutation', () => {
    const result = planDataRetention(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T01:10:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_DATA_RETENTION_PLANNED_EVENT)
    expect(result.retentionReadinessStatus).toBe('ready')
    expect(result.eventRetentionPlanning.status).toBe('ready')
    expect(result.auditRetentionPlanning.status).toBe('ready')
    expect(result.workspaceRetentionPlanning.status).toBe('ready')
    expect(result.backtestRetentionPlanning.status).toBe('ready')
    expect(result.researchRetentionPlanning.status).toBe('ready')
    expect(result.futurePostgresRetentionPlaceholder.implemented).toBe(true)
    expect(result.databaseMigrationAdded).toBe(false)
    expect(result.userDataDeleted).toBe(false)
    expect(result.userDataMutated).toBe(false)
    expect(result.liveOrders).toBe(false)
  })

  it('returns caution while future PostgreSQL retention remains a placeholder', () => {
    const result = planDataRetention({
      ...baseInput,
      workspacePersistence: {
        ...baseInput.workspacePersistence,
        futurePostgresPersistenceInterface: { implemented: false },
      },
    }, { emitEvent: false })

    expect(result.retentionReadinessStatus).toBe('caution')
    expect(result.futurePostgresRetentionPlaceholder.migrationAdded).toBe(false)
  })

  it('emits data retention planned events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_DATA_RETENTION_PLANNED_EVENT, (payload) => events.push(payload))

    const result = createDataRetentionPlanningEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
