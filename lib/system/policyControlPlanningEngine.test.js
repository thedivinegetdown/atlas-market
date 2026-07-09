import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_POLICY_CONTROL_PLANNED_EVENT,
  createPolicyControlPlanningEngine,
  planPolicyControl,
} from './policyControlPlanningEngine.js'

const baseInput = {
  complianceReadiness: {
    eventType: 'system.complianceReadiness.evaluated',
    complianceReadinessStatus: 'ready',
    paperTradingComplianceBoundarySummary: { status: 'ready' },
  },
  workspacePersistence: { eventType: 'workspace.persistence.prepared', persistenceStatus: 'ready' },
  dataQualityReadiness: { eventType: 'system.dataQuality.evaluated', dataQualityStatus: 'ready' },
  dataLineage: { eventType: 'system.dataLineage.evaluated', lineageStatus: 'valid' },
  dataRetentionPlanning: { eventType: 'system.dataRetention.planned', retentionReadinessStatus: 'ready' },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
  productionDeploymentReadiness: { eventType: 'system.deploymentReadiness.evaluated', deploymentReadinessStatus: 'ready' },
  operatorActionCenter: { eventType: 'system.operatorActions.generated' },
  systemHealthCommandCenter: { eventType: 'system.healthCommandCenter.evaluated', finalPlatformHealthStatus: 'operational' },
}

describe('policy control planning engine', () => {
  it('plans future policy controls without enforcing policies', () => {
    const result = planPolicyControl(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T02:05:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_POLICY_CONTROL_PLANNED_EVENT)
    expect(result.policyReadinessStatus).toBe('ready')
    expect(result.futurePolicyModelPlaceholder.implemented).toBe(false)
    expect(result.futurePolicyModelPlaceholder.enforcementEnabled).toBe(false)
    expect(result.policyCategorySummary.totalCategories).toBe(4)
    expect(result.workspacePolicyPlanning.status).toBe('ready')
    expect(result.tradingSafetyPolicyPlanning.controls).toContain('no-live-orders')
    expect(result.policyEnforced).toBe(false)
    expect(result.authenticationAdded).toBe(false)
    expect(result.userAccountsAdded).toBe(false)
  })

  it('returns caution when data policy dependencies are not fully ready', () => {
    const result = planPolicyControl({
      ...baseInput,
      dataRetentionPlanning: { ...baseInput.dataRetentionPlanning, retentionReadinessStatus: 'caution' },
    }, { emitEvent: false })

    expect(result.policyReadinessStatus).toBe('caution')
    expect(result.dataPolicyPlanning.status).toBe('caution')
  })

  it('emits policy control planned events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_POLICY_CONTROL_PLANNED_EVENT, (payload) => events.push(payload))

    const result = createPolicyControlPlanningEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
