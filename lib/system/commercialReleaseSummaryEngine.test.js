import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_COMMERCIAL_RELEASE_SUMMARIZED_EVENT,
  createCommercialReleaseSummaryEngine,
  summarizeCommercialRelease,
} from './commercialReleaseSummaryEngine.js'

const baseInput = {
  enterpriseReleaseControl: { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' },
  releaseReadiness: { eventType: 'system.releaseReadiness.evaluated', releaseReadinessStatus: 'ready' },
  launchReadinessReview: { eventType: 'system.launchReadiness.reviewed', launchReadinessStatus: 'ready' },
  commercialReadiness: { eventType: 'system.commercialReadiness.evaluated', commercialReadinessStatus: 'ready' },
  supportOperationsReadiness: { eventType: 'system.supportOperations.evaluated', supportReadinessStatus: 'ready' },
}

describe('commercial release summary engine', () => {
  it('summarizes release-ready commercial planning without authorizing deployment or billing', () => {
    const result = summarizeCommercialRelease(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T04:10:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_COMMERCIAL_RELEASE_SUMMARIZED_EVENT)
    expect(result.finalCommercialReleaseStatus).toBe('release-ready')
    expect(result.releaseCandidateSummary.status).toBe('release-ready')
    expect(result.launchReadinessSummary.status).toBe('release-ready')
    expect(result.commercialReadinessSummary.status).toBe('release-ready')
    expect(result.supportReadinessSummary.status).toBe('release-ready')
    expect(result.remainingBlockerSummary.blockerCount).toBe(0)
    expect(result.remainingBlockerSummary.deploymentAuthorized).toBe(false)
    expect(result.remainingBlockerSummary.billingAuthorized).toBe(false)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('blocks commercial release when launch readiness is blocked', () => {
    const result = summarizeCommercialRelease({
      ...baseInput,
      launchReadinessReview: {
        ...baseInput.launchReadinessReview,
        launchReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.finalCommercialReleaseStatus).toBe('blocked')
    expect(result.remainingBlockerSummary.blockedSections).toContain('launch-readiness')
  })

  it('emits commercial release summarized events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_COMMERCIAL_RELEASE_SUMMARIZED_EVENT, (payload) => events.push(payload))

    const result = createCommercialReleaseSummaryEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
