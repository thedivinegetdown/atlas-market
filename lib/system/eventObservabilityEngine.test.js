import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_EVENTS_OBSERVED_EVENT,
  createEventObservabilityEngine,
  observeSystemEvents,
} from './eventObservabilityEngine.js'

const baseEvents = Object.freeze([
  Object.freeze({ label: 'Risk', eventType: 'portfolio.risk.evaluated', status: 'controlled', timestamp: '2026-07-08T10:00:00.000Z' }),
  Object.freeze({ label: 'Guardrail', eventType: 'trade.guardrail.evaluated', status: 'approved', timestamp: '2026-07-08T10:01:00.000Z' }),
  Object.freeze({ label: 'Execution', eventType: 'trade.execution.simulated', status: 'filled', timestamp: '2026-07-08T10:02:00.000Z' }),
  Object.freeze({ label: 'Research', eventType: 'research.marketIntelligence.evaluated', status: 'supportive', timestamp: '2026-07-08T10:03:00.000Z' }),
  Object.freeze({ label: 'Strategy', eventType: 'strategy.signal.composed', status: 'composed', timestamp: '2026-07-08T10:04:00.000Z' }),
  Object.freeze({ label: 'Backtest', eventType: 'strategy.backtestPerformance.evaluated', status: 'evaluated', timestamp: '2026-07-08T10:05:00.000Z' }),
  Object.freeze({ label: 'Optimization', eventType: 'portfolio.optimization.recommended', status: 'medium', timestamp: '2026-07-08T10:06:00.000Z' }),
  Object.freeze({ label: 'AI', eventType: 'ai.decision.orchestrated', status: 'approve', timestamp: '2026-07-08T10:07:00.000Z' }),
  Object.freeze({ label: 'Readiness', eventType: 'system.releaseReadiness.evaluated', status: 'ready', timestamp: '2026-07-08T10:08:00.000Z' }),
  Object.freeze({ label: 'Stabilization', eventType: 'system.releaseCandidate.stabilized', status: 'stable', timestamp: '2026-07-08T10:09:00.000Z' }),
])

const requiredEventTypes = Object.freeze([
  'portfolio.risk.evaluated',
  'trade.guardrail.evaluated',
  'trade.execution.simulated',
  'ai.decision.orchestrated',
  'system.releaseReadiness.evaluated',
  'system.releaseCandidate.stabilized',
])

describe('event observability engine', () => {
  it('summarizes healthy event catalog observability across event families', () => {
    const result = observeSystemEvents({
      events: baseEvents,
      requiredEventTypes,
      criticalEventTypes: requiredEventTypes,
      releaseReadiness: { eventType: 'system.releaseReadiness.evaluated', releaseReadinessStatus: 'ready' },
      releaseCandidateStabilization: { eventType: 'system.releaseCandidate.stabilized', finalStatus: 'stable' },
      maxEventAgeMs: 1000 * 60 * 60,
      now: '2026-07-08T10:15:00.000Z',
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T10:16:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_EVENTS_OBSERVED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.observabilityStatus).toBe('healthy')
    expect(result.eventCatalogSummary.uniqueEventTypes).toBe(baseEvents.length)
    expect(result.eventFamilyGrouping.map((family) => family.family)).toContain('research')
    expect(result.eventFreshnessCheck.staleCount).toBe(0)
    expect(result.missingEventDetection.missingCount).toBe(0)
    expect(result.criticalEventHealthStatus.status).toBe('healthy')
  })

  it('detects missing required events, duplicate contracts, and stale observations', () => {
    const result = observeSystemEvents({
      events: [
        ...baseEvents.filter((event) => event.eventType !== 'ai.decision.orchestrated'),
        { label: 'Duplicate risk', eventType: 'portfolio.risk.evaluated', status: 'controlled', timestamp: '2026-07-07T08:00:00.000Z' },
      ],
      requiredEventTypes,
      criticalEventTypes: requiredEventTypes,
      releaseReadiness: { releaseReadinessStatus: 'ready' },
      releaseCandidateStabilization: { finalStatus: 'stable' },
      maxEventAgeMs: 1000 * 60,
      now: '2026-07-08T10:15:00.000Z',
    }, { emitEvent: false })

    expect(result.observabilityStatus).toBe('degraded')
    expect(result.missingEventDetection.missingEventTypes).toContain('ai.decision.orchestrated')
    expect(result.duplicateEventDetection.duplicates[0]).toMatchObject({ eventType: 'portfolio.risk.evaluated', count: 2 })
    expect(result.eventFreshnessCheck.staleCount).toBeGreaterThan(0)
  })

  it('degrades critical event health when a critical event has degraded status', () => {
    const result = observeSystemEvents({
      events: baseEvents.map((event) => event.eventType === 'trade.execution.simulated'
        ? { ...event, status: 'failed' }
        : event),
      requiredEventTypes,
      criticalEventTypes: requiredEventTypes,
      releaseReadiness: { releaseReadinessStatus: 'ready' },
      releaseCandidateStabilization: { finalStatus: 'stable' },
      now: '2026-07-08T10:15:00.000Z',
    }, { emitEvent: false })

    expect(result.observabilityStatus).toBe('degraded')
    expect(result.criticalEventHealthStatus.degradedCritical).toContain('trade.execution.simulated')
  })

  it('emits system events observed events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_EVENTS_OBSERVED_EVENT, (payload) => events.push(payload))

    const result = createEventObservabilityEngine({ eventBus }).observe({
      events: baseEvents,
      requiredEventTypes,
      criticalEventTypes: requiredEventTypes,
      now: '2026-07-08T10:15:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_EVENTS_OBSERVED_EVENT)
  })
})
