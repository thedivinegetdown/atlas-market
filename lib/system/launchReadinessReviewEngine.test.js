import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_LAUNCH_READINESS_REVIEWED_EVENT,
  createLaunchReadinessReviewEngine,
  reviewLaunchReadiness,
} from './launchReadinessReviewEngine.js'

const baseInput = {
  systemHealthCommandCenter: { eventType: 'system.healthCommandCenter.evaluated', finalPlatformHealthStatus: 'operational' },
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
  productionDeploymentReadiness: { eventType: 'system.deploymentReadiness.evaluated', deploymentReadinessStatus: 'ready' },
  productionSecurityReadiness: { eventType: 'system.securityReadiness.evaluated', securityReadinessStatus: 'ready' },
  governanceReviewBoard: { eventType: 'system.governanceReview.evaluated', governanceDecision: 'approved' },
  commercialReadiness: { eventType: 'system.commercialReadiness.evaluated', commercialReadinessStatus: 'ready' },
  supportOperationsReadiness: {
    eventType: 'system.supportOperations.evaluated',
    supportReadinessStatus: 'ready',
    supportWorkflowPlaceholder: { implemented: false },
  },
}

describe('launch readiness review engine', () => {
  it('reviews launch gates without deployment or commercial side effects', () => {
    const result = reviewLaunchReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T04:05:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_LAUNCH_READINESS_REVIEWED_EVENT)
    expect(result.launchReadinessStatus).toBe('ready')
    expect(result.productReadinessGate.status).toBe('ready')
    expect(result.deploymentReadinessGate.deploymentTriggered).toBe(false)
    expect(result.securityReadinessGate.authenticationEnforced).toBe(false)
    expect(result.governanceReadinessGate.policyEnforced).toBe(false)
    expect(result.commercialReadinessGate.billingEnabled).toBe(false)
    expect(result.supportReadinessGate.status).toBe('ready')
    expect(result.deploymentTriggered).toBe(false)
    expect(result.paymentsEnabled).toBe(false)
    expect(result.userAccountsAdded).toBe(false)
  })

  it('blocks launch readiness when security readiness is blocked', () => {
    const result = reviewLaunchReadiness({
      ...baseInput,
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        securityReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.launchReadinessStatus).toBe('blocked')
    expect(result.securityReadinessGate.status).toBe('blocked')
  })

  it('emits launch readiness reviewed events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_LAUNCH_READINESS_REVIEWED_EVENT, (payload) => events.push(payload))

    const result = createLaunchReadinessReviewEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
