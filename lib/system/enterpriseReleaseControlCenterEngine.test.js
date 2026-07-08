import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_RELEASE_CONTROL_EVALUATED_EVENT,
  createEnterpriseReleaseControlCenterEngine,
  evaluateEnterpriseReleaseControl,
} from './enterpriseReleaseControlCenterEngine.js'

const stableInput = Object.freeze({
  releaseReadiness: Object.freeze({
    eventType: 'system.releaseReadiness.evaluated',
    releaseReadinessStatus: 'ready',
    summary: 'Ready.',
  }),
  releaseCandidateStabilization: Object.freeze({
    eventType: 'system.releaseCandidate.stabilized',
    finalStatus: 'stable',
    summary: 'Stable.',
  }),
  systemHealthCommandCenter: Object.freeze({
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
    summary: 'Operational.',
    sourceEvents: Object.freeze({ eventObservability: 'system.events.observed' }),
  }),
  eventObservability: Object.freeze({
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
    summary: 'Healthy.',
    missingEventDetection: Object.freeze({ missingEventTypes: Object.freeze([]) }),
    duplicateEventDetection: Object.freeze({ duplicateEventTypes: Object.freeze([]) }),
  }),
  operatorActionCenter: Object.freeze({
    eventType: 'system.operatorActions.generated',
    summary: 'Low severity operator review.',
    platformActionSummary: Object.freeze({ topSeverity: 'low', openActions: 1 }),
    prioritizedOperatorActions: Object.freeze([
      Object.freeze({ id: 'approve-operational-posture', severity: 'low' }),
    ]),
    sourceEvents: Object.freeze({ systemHealthCommandCenter: 'system.healthCommandCenter.evaluated' }),
  }),
  enterpriseAuditTrail: Object.freeze({
    eventType: 'system.auditTrail.recorded',
    summary: 'Audit valid.',
    auditIntegrityStatus: Object.freeze({ status: 'valid' }),
    eventChainReferences: Object.freeze(['system.events.observed']),
    operatorActionReferences: Object.freeze(['approve-operational-posture']),
    riskDecisionReferences: Object.freeze(['portfolio.risk.evaluated']),
  }),
})

describe('enterprise release control center engine', () => {
  it('evaluates a release-ready enterprise release decision', () => {
    const result = evaluateEnterpriseReleaseControl(stableInput, {
      emitEvent: false,
      timestamp: '2026-07-08T15:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_RELEASE_CONTROL_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerageIntegration).toBe(false)
    expect(result.finalReleaseStatus).toBe('release-ready')
    expect(result.releaseDecisionSummary.passedGateCount).toBe(6)
    expect(result.readinessGateReview.status).toBe('passed')
    expect(result.stabilizationGateReview.status).toBe('passed')
    expect(result.systemHealthGateReview.status).toBe('passed')
    expect(result.eventObservabilityGateReview.status).toBe('passed')
    expect(result.operatorActionGateReview.status).toBe('passed')
    expect(result.auditTrailGateReview.status).toBe('passed')
    expect(result.sourceEvents.enterpriseAuditTrail).toBe('system.auditTrail.recorded')
  })

  it('returns caution when non-blocking release gates need review', () => {
    const result = evaluateEnterpriseReleaseControl({
      ...stableInput,
      releaseReadiness: {
        ...stableInput.releaseReadiness,
        releaseReadinessStatus: 'caution',
      },
      operatorActionCenter: {
        ...stableInput.operatorActionCenter,
        platformActionSummary: { topSeverity: 'high', openActions: 2 },
      },
      enterpriseAuditTrail: {
        ...stableInput.enterpriseAuditTrail,
        auditIntegrityStatus: { status: 'caution' },
      },
    }, { emitEvent: false })

    expect(result.finalReleaseStatus).toBe('caution')
    expect(result.releaseDecisionSummary.cautionGateCount).toBe(3)
    expect(result.releaseRationaleSummary).toContain('caution review')
  })

  it('blocks release when a critical upstream gate is blocked', () => {
    const result = evaluateEnterpriseReleaseControl({
      ...stableInput,
      eventObservability: {
        ...stableInput.eventObservability,
        observabilityStatus: 'degraded',
        missingEventDetection: { missingEventTypes: ['system.releaseControl.evaluated'] },
      },
      enterpriseAuditTrail: {
        ...stableInput.enterpriseAuditTrail,
        auditIntegrityStatus: { status: 'invalid' },
      },
    }, { emitEvent: false })

    expect(result.finalReleaseStatus).toBe('blocked')
    expect(result.releaseDecisionSummary.blockedGateCount).toBe(2)
    expect(result.eventObservabilityGateReview.references).toContain('system.releaseControl.evaluated')
    expect(result.auditTrailGateReview.status).toBe('blocked')
  })

  it('emits system release control evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_RELEASE_CONTROL_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createEnterpriseReleaseControlCenterEngine({ eventBus }).evaluate(stableInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_RELEASE_CONTROL_EVALUATED_EVENT)
  })
})
