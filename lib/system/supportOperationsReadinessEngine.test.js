import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_SUPPORT_OPERATIONS_EVALUATED_EVENT,
  createSupportOperationsReadinessEngine,
  evaluateSupportOperationsReadiness,
} from './supportOperationsReadinessEngine.js'

const baseInput = {
  productionOperationsRunbook: {
    eventType: 'system.operationsRunbook.generated',
    operatorHandoffSummary: { handoffStatus: 'ready' },
    startupChecklistSummary: [{ id: 'startup' }],
    incidentResponseChecklist: [{ id: 'incident' }],
    rollbackReadinessChecklist: [{ id: 'rollback' }],
  },
  customerOnboardingReadiness: {
    eventType: 'system.customerOnboarding.evaluated',
    onboardingReadinessStatus: 'ready',
    onboardingFlowPlaceholder: { implemented: false },
  },
  productionIncidentResponse: {
    eventType: 'system.incidentResponse.planned',
    incidentReadinessStatus: 'ready',
    escalationPlanning: { escalationRequired: false },
  },
  productionMonitoringPlan: {
    eventType: 'system.monitoringPlan.generated',
    monitoringReadinessStatus: 'ready',
    monitoringSignalCatalog: [{ id: 'health' }],
  },
  systemHealthCommandCenter: { eventType: 'system.healthCommandCenter.evaluated', finalPlatformHealthStatus: 'operational' },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
}

describe('support operations readiness engine', () => {
  it('evaluates support readiness without accounts, billing, deployment, or broker execution', () => {
    const result = evaluateSupportOperationsReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T04:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_SUPPORT_OPERATIONS_EVALUATED_EVENT)
    expect(result.supportReadinessStatus).toBe('ready')
    expect(result.supportWorkflowPlaceholder.implemented).toBe(false)
    expect(result.operatorSupportRunbookSummary.status).toBe('ready')
    expect(result.customerSupportReadinessSummary.status).toBe('ready')
    expect(result.incidentSupportEscalationSummary.status).toBe('ready')
    expect(result.documentationReadinessSummary.status).toBe('ready')
    expect(result.billingEnabled).toBe(false)
    expect(result.userAccountsAdded).toBe(false)
    expect(result.deploymentTriggered).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('blocks support readiness when incident response is blocked', () => {
    const result = evaluateSupportOperationsReadiness({
      ...baseInput,
      productionIncidentResponse: {
        ...baseInput.productionIncidentResponse,
        incidentReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.supportReadinessStatus).toBe('blocked')
    expect(result.incidentSupportEscalationSummary.status).toBe('blocked')
  })

  it('emits support operations evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_SUPPORT_OPERATIONS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createSupportOperationsReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
