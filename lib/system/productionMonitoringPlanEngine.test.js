import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_MONITORING_PLAN_GENERATED_EVENT,
  createProductionMonitoringPlanEngine,
  generateProductionMonitoringPlan,
} from './productionMonitoringPlanEngine.js'

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
  productionIncidentResponse: {
    eventType: 'system.incidentResponse.planned',
    incidentReadinessStatus: 'ready',
  },
  productionRollbackReadiness: {
    eventType: 'system.rollbackReadiness.evaluated',
    rollbackReadinessStatus: 'ready',
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
    criticalEventHealthStatus: 'healthy',
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
    moduleHealthRegistry: [{ id: 'trading', status: 'ready' }],
  },
  operatorActionCenter: {
    eventType: 'system.operatorActions.generated',
    platformActionSummary: { topSeverity: 'low' },
  },
}

describe('production monitoring plan engine', () => {
  it('generates a ready monitoring plan across operational signal families', () => {
    const result = generateProductionMonitoringPlan(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T00:30:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_MONITORING_PLAN_GENERATED_EVENT)
    expect(result.monitoringReadinessStatus).toBe('ready')
    expect(result.monitoringSignalCatalog).toHaveLength(14)
    expect(result.healthMonitoringSummary.status).toBe('ready')
    expect(result.eventObservabilityMonitoringSummary.status).toBe('ready')
    expect(result.securityMonitoringSummary.status).toBe('ready')
    expect(result.deploymentMonitoringSummary.status).toBe('ready')
    expect(result.operatorActionMonitoringSummary.status).toBe('ready')
    expect(result.monitoringSignalCatalog.every((entry) => entry.automatedPaging === false)).toBe(true)
    expect(result.liveOrders).toBe(false)
  })

  it('returns caution when monitoring dependencies need operator review', () => {
    const result = generateProductionMonitoringPlan({
      ...baseInput,
      productionEnvironmentConfiguration: {
        ...baseInput.productionEnvironmentConfiguration,
        configurationReadinessStatus: 'caution',
      },
    }, { emitEvent: false })

    expect(result.monitoringReadinessStatus).toBe('caution')
    expect(result.deploymentMonitoringSummary.cautionCount).toBeGreaterThan(0)
  })

  it('emits monitoring plan generated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_MONITORING_PLAN_GENERATED_EVENT, (payload) => events.push(payload))

    const result = createProductionMonitoringPlanEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
