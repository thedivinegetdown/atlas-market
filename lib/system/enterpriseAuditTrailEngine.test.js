import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_AUDIT_TRAIL_RECORDED_EVENT,
  createEnterpriseAuditTrailEngine,
  recordEnterpriseAuditTrail,
} from './enterpriseAuditTrailEngine.js'

const baseInput = Object.freeze({
  eventObservability: Object.freeze({
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
    timestamp: '2026-07-08T14:00:00.000Z',
    summary: 'Events observed.',
    missingEventDetection: Object.freeze({ missingEventTypes: Object.freeze([]) }),
  }),
  operatorActionCenter: Object.freeze({
    eventType: 'system.operatorActions.generated',
    timestamp: '2026-07-08T14:01:00.000Z',
    prioritizedOperatorActions: Object.freeze([
      Object.freeze({
        id: 'system-health-approve-operational-posture',
        category: 'approve',
        severity: 'low',
        title: 'Acknowledge operational platform posture',
        rationale: 'Platform is operational.',
        sourceReferences: Object.freeze(['system.healthCommandCenter.evaluated']),
      }),
    ]),
  }),
  strategyLifecycle: Object.freeze({
    eventType: 'strategy.lifecycle.updated',
    timestamp: '2026-07-08T14:02:00.000Z',
    strategyId: 'index-pullback-v1',
    lifecycleState: 'active',
    lifecycleAuditEvent: Object.freeze({ transition: 'validated->active' }),
    sourceEvents: Object.freeze({ strategySignalComposition: 'strategy.signal.composed' }),
  }),
  portfolioRisk: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    timestamp: '2026-07-08T14:03:00.000Z',
    summary: Object.freeze({ riskLevel: 'controlled' }),
  }),
  tradeGuardrail: Object.freeze({
    eventType: 'trade.guardrail.evaluated',
    timestamp: '2026-07-08T14:04:00.000Z',
    decision: 'approved',
  }),
  releaseReadiness: Object.freeze({
    eventType: 'system.releaseReadiness.evaluated',
    timestamp: '2026-07-08T14:05:00.000Z',
    releaseReadinessStatus: 'ready',
    summary: 'Ready.',
  }),
  systemHealthCommandCenter: Object.freeze({
    eventType: 'system.healthCommandCenter.evaluated',
    timestamp: '2026-07-08T14:06:00.000Z',
    finalPlatformHealthStatus: 'operational',
    summary: 'System operational.',
    sourceEvents: Object.freeze({ eventObservability: 'system.events.observed' }),
  }),
})

describe('enterprise audit trail engine', () => {
  it('records a valid normalized enterprise audit trail', () => {
    const result = recordEnterpriseAuditTrail(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T14:07:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_AUDIT_TRAIL_RECORDED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.auditIntegrityStatus.status).toBe('valid')
    expect(result.normalizedAuditRecords.length).toBeGreaterThanOrEqual(7)
    expect(result.auditCategoryGrouping.map((group) => group.category)).toContain('operator_action')
    expect(result.actorSourceAttribution[0]).toHaveProperty('actor')
    expect(result.eventChainReferences).toContain('system.events.observed')
    expect(result.operatorActionReferences).toContain('system-health-approve-operational-posture')
    expect(result.strategyLifecycleReferences).toContain('validated->active')
    expect(result.riskDecisionReferences).toContain('portfolio.risk.evaluated')
  })

  it('marks integrity as caution when critical audit records are present', () => {
    const result = recordEnterpriseAuditTrail({
      ...baseInput,
      eventObservability: {
        ...baseInput.eventObservability,
        observabilityStatus: 'degraded',
        missingEventDetection: { missingEventTypes: ['ai.decision.orchestrated'] },
      },
      operatorActionCenter: {
        ...baseInput.operatorActionCenter,
        prioritizedOperatorActions: [
          {
            id: 'risk-pause-critical-portfolio-risk',
            category: 'pause',
            severity: 'critical',
            title: 'Pause new paper risk',
            rationale: 'Critical portfolio risk.',
            sourceReferences: ['portfolio.risk.evaluated'],
          },
        ],
      },
      portfolioRisk: {
        ...baseInput.portfolioRisk,
        summary: { riskLevel: 'critical' },
      },
    }, { emitEvent: false })

    expect(result.auditIntegrityStatus.status).toBe('caution')
    expect(result.auditSeverityClassification.critical).toBeGreaterThan(0)
    expect(result.eventChainReferences).toContain('ai.decision.orchestrated')
  })

  it('marks integrity invalid when records are missing event contracts', () => {
    const result = recordEnterpriseAuditTrail({
      ...baseInput,
      releaseReadiness: {
        ...baseInput.releaseReadiness,
        eventType: null,
      },
    }, { emitEvent: false })

    expect(result.auditIntegrityStatus.status).toBe('invalid')
    expect(result.auditIntegrityStatus.missingEventTypeCount).toBeGreaterThan(0)
  })

  it('emits system audit trail recorded events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_AUDIT_TRAIL_RECORDED_EVENT, (payload) => events.push(payload))

    const result = createEnterpriseAuditTrailEngine({ eventBus }).record(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_AUDIT_TRAIL_RECORDED_EVENT)
  })
})
