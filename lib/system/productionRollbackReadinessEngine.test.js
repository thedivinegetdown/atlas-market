import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_ROLLBACK_READINESS_EVALUATED_EVENT,
  createProductionRollbackReadinessEngine,
  evaluateProductionRollbackReadiness,
} from './productionRollbackReadinessEngine.js'

const baseInput = {
  productionDeploymentReadiness: {
    eventType: 'system.deploymentReadiness.evaluated',
    deploymentReadinessStatus: 'ready',
  },
  productionSecurityReadiness: {
    eventType: 'system.securityReadiness.evaluated',
    securityReadinessStatus: 'ready',
    environmentSecretHandlingSummary: { status: 'ready' },
    apiBoundarySecuritySummary: { status: 'ready' },
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
  productionIncidentResponse: {
    eventType: 'system.incidentResponse.planned',
    incidentReadinessStatus: 'ready',
    rollbackRecommendationSummary: { recommendation: 'monitor' },
  },
  enterpriseReleaseControl: {
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
  },
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  },
}

describe('production rollback readiness engine', () => {
  it('evaluates rollback readiness without authorizing execution', () => {
    const result = evaluateProductionRollbackReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T00:25:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_ROLLBACK_READINESS_EVALUATED_EVENT)
    expect(result.rollbackReadinessStatus).toBe('ready')
    expect(result.rollbackCriteriaSummary.rollbackExecutionAuthorized).toBe(false)
    expect(result.deploymentRollbackChecklist).toHaveLength(3)
    expect(result.configurationRollbackChecklist).toHaveLength(3)
    expect(result.rollbackBlockerSummary.rollbackExecutable).toBe(false)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('blocks rollback readiness when release control or paper safety is blocked', () => {
    const result = evaluateProductionRollbackReadiness({
      ...baseInput,
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        paperTradingSafetyLockSummary: { status: 'blocked' },
      },
      enterpriseReleaseControl: {
        ...baseInput.enterpriseReleaseControl,
        finalReleaseStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.rollbackReadinessStatus).toBe('blocked')
    expect(result.rollbackBlockerSummary.blockerCount).toBeGreaterThan(0)
    expect(result.deploymentTriggered).toBe(false)
  })

  it('emits rollback readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_ROLLBACK_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createProductionRollbackReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
