import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_GOVERNANCE_REVIEW_EVALUATED_EVENT,
  createGovernanceReviewBoardEngine,
  evaluateGovernanceReviewBoard,
} from './governanceReviewBoardEngine.js'

const baseInput = {
  complianceReadiness: { eventType: 'system.complianceReadiness.evaluated', complianceReadinessStatus: 'ready' },
  policyControlPlanning: { eventType: 'system.policyControl.planned', policyReadinessStatus: 'ready' },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
  operatorActionCenter: {
    eventType: 'system.operatorActions.generated',
    platformActionSummary: { topSeverity: 'low' },
  },
  systemHealthCommandCenter: {
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  },
  productionDeploymentReadiness: { eventType: 'system.deploymentReadiness.evaluated' },
  productionSecurityReadiness: { eventType: 'system.securityReadiness.evaluated' },
}

describe('governance review board engine', () => {
  it('evaluates a placeholder review board without enforcement', () => {
    const result = evaluateGovernanceReviewBoard(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T02:10:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_GOVERNANCE_REVIEW_EVALUATED_EVENT)
    expect(result.governanceDecision).toBe('approved')
    expect(result.reviewBoardModelPlaceholder.implemented).toBe(false)
    expect(result.reviewBoardModelPlaceholder.decisionEnforcementEnabled).toBe(false)
    expect(result.reviewDomainSummary.totalDomains).toBe(4)
    expect(result.complianceReviewSummary.status).toBe('approved')
    expect(result.policyReviewSummary.status).toBe('approved')
    expect(result.releaseReviewSummary.status).toBe('approved')
    expect(result.riskReviewSummary.status).toBe('approved')
    expect(result.legalClaimMade).toBe(false)
    expect(result.policyEnforced).toBe(false)
  })

  it('blocks governance decision when policy review is blocked', () => {
    const result = evaluateGovernanceReviewBoard({
      ...baseInput,
      policyControlPlanning: {
        ...baseInput.policyControlPlanning,
        policyReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.governanceDecision).toBe('blocked')
    expect(result.policyReviewSummary.status).toBe('blocked')
  })

  it('emits governance review evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_GOVERNANCE_REVIEW_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createGovernanceReviewBoardEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
