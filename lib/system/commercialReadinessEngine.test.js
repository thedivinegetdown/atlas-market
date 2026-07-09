import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_COMMERCIAL_READINESS_EVALUATED_EVENT,
  createCommercialReadinessEngine,
  evaluateCommercialReadiness,
} from './commercialReadinessEngine.js'

const baseInput = {
  enterpriseSaasReadiness: { eventType: 'system.saasReadiness.evaluated', saasReadinessStatus: 'ready' },
  productionDeploymentReadiness: { eventType: 'system.deploymentReadiness.evaluated', deploymentReadinessStatus: 'ready' },
  productionSecurityReadiness: { eventType: 'system.securityReadiness.evaluated', securityReadinessStatus: 'ready' },
  complianceReadiness: { eventType: 'system.complianceReadiness.evaluated', complianceReadinessStatus: 'ready' },
  governanceReviewBoard: { eventType: 'system.governanceReview.evaluated', governanceDecision: 'approved' },
  productionOperationsRunbook: {
    eventType: 'system.operationsRunbook.generated',
    operatorHandoffSummary: { handoffStatus: 'ready' },
  },
  operatorActionCenter: {
    eventType: 'system.operatorActions.generated',
    platformActionSummary: { topSeverity: 'low' },
  },
  systemHealthCommandCenter: { eventType: 'system.healthCommandCenter.evaluated', finalPlatformHealthStatus: 'operational' },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
}

describe('commercial readiness engine', () => {
  it('evaluates commercial readiness without billing, payments, or accounts', () => {
    const result = evaluateCommercialReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T03:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_COMMERCIAL_READINESS_EVALUATED_EVENT)
    expect(result.commercialReadinessStatus).toBe('ready')
    expect(result.productReadinessSummary.status).toBe('ready')
    expect(result.saasReadinessSummary.status).toBe('ready')
    expect(result.deploymentReadinessSummary.status).toBe('ready')
    expect(result.securityReadinessSummary.status).toBe('ready')
    expect(result.complianceGovernanceReadinessSummary.status).toBe('ready')
    expect(result.operatorReadinessSummary.status).toBe('ready')
    expect(result.billingEnabled).toBe(false)
    expect(result.paymentsEnabled).toBe(false)
    expect(result.authenticationEnforced).toBe(false)
    expect(result.userAccountsAdded).toBe(false)
    expect(result.liveOrders).toBe(false)
  })

  it('blocks commercial readiness when governance is blocked', () => {
    const result = evaluateCommercialReadiness({
      ...baseInput,
      governanceReviewBoard: {
        ...baseInput.governanceReviewBoard,
        governanceDecision: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.commercialReadinessStatus).toBe('blocked')
    expect(result.complianceGovernanceReadinessSummary.status).toBe('blocked')
  })

  it('emits commercial readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_COMMERCIAL_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createCommercialReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
