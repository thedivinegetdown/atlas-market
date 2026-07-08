import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_INCIDENT_RESPONSE_PLANNED_EVENT,
  createProductionIncidentResponsePlanner,
  planProductionIncidentResponse,
} from './productionIncidentResponsePlanner.js'

const baseInput = {
  productionDeploymentReadiness: {
    eventType: 'system.deploymentReadiness.evaluated',
    deploymentReadinessStatus: 'ready',
  },
  productionSecurityReadiness: {
    eventType: 'system.securityReadiness.evaluated',
    securityReadinessStatus: 'ready',
    paperTradingSafetyLockSummary: { status: 'ready' },
  },
  productionEnvironmentConfiguration: {
    eventType: 'system.environmentConfiguration.planned',
    configurationReadinessStatus: 'ready',
  },
  productionOperationsRunbook: {
    eventType: 'system.operationsRunbook.generated',
    operatorHandoffSummary: { handoffStatus: 'ready' },
  },
  enterpriseReleaseControl: {
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
  },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
  },
  eventObservability: {
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  },
  operatorActionCenter: {
    eventType: 'system.operatorActions.generated',
    platformActionSummary: { topSeverity: 'low' },
  },
}

describe('production incident response planner', () => {
  it('builds a ready, non-executable incident response plan', () => {
    const result = planProductionIncidentResponse(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T00:20:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_INCIDENT_RESPONSE_PLANNED_EVENT)
    expect(result.incidentReadinessStatus).toBe('ready')
    expect(result.incidentCategoryModel).toHaveLength(6)
    expect(result.operatorResponseSteps).toHaveLength(5)
    expect(result.escalationPlanning.liveBrokerEscalation).toBe(false)
    expect(result.rollbackRecommendationSummary.rollbackExecuted).toBe(false)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.operatorResponseSteps.every((step) => step.executable === false)).toBe(true)
  })

  it('blocks incident readiness when paper-mode security is blocked', () => {
    const result = planProductionIncidentResponse({
      ...baseInput,
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        securityReadinessStatus: 'blocked',
        paperTradingSafetyLockSummary: { status: 'blocked' },
      },
    }, { emitEvent: false })

    expect(result.incidentReadinessStatus).toBe('blocked')
    expect(result.escalationPlanning.escalationRequired).toBe(true)
    expect(result.rollbackRecommendationSummary.recommendation).toBe('prepare-rollback-review')
  })

  it('emits incident response planned events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_INCIDENT_RESPONSE_PLANNED_EVENT, (payload) => events.push(payload))

    const result = createProductionIncidentResponsePlanner({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
