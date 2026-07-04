import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_RELEASE_CANDIDATE_STABILIZED_EVENT,
  buildRegressionChecklist,
  checkEventPipelineIntegrity,
  createReleaseCandidateStabilizationEngine,
  evaluateReleaseCandidateStabilization,
  summarizeCriticalModuleHealth,
  summarizeDashboardSmokeTests,
  verifyAdapterMockMode,
  verifyPaperTradingSafetyLock,
} from './releaseCandidateStabilization.js'

const stableInput = Object.freeze({
  releaseReadiness: Object.freeze({ releaseReadinessStatus: 'ready', ready: true }),
  brokerHealth: Object.freeze({ paperTrading: true, liveOrders: false }),
  adapters: Object.freeze([
    Object.freeze({
      name: 'Mock Market Data Adapter',
      provider: 'mock-market-data-adapter',
      default: true,
      paperTrading: true,
      liveOrders: false,
    }),
    Object.freeze({
      name: 'Mock Paper Broker Adapter',
      provider: 'mock-paper-broker-adapter',
      default: true,
      paperTrading: true,
      liveOrders: false,
    }),
  ]),
  regressionChecklist: Object.freeze([
    Object.freeze({ name: 'paper execution lifecycle', status: 'passed', evidence: 'simulated fill' }),
    Object.freeze({ name: 'portfolio accounting lifecycle', status: 'passed', evidence: 'paper account updated' }),
  ]),
  criticalModules: Object.freeze([
    Object.freeze({ name: 'release readiness', status: 'ready', eventType: 'system.releaseReadiness.evaluated' }),
    Object.freeze({ name: 'trade guardrail', status: 'healthy', eventType: 'trade.guardrail.evaluated' }),
  ]),
  dashboardSmokeTests: Object.freeze([
    Object.freeze({ name: 'release readiness panel', panel: 'Release Readiness', status: 'passed' }),
    Object.freeze({ name: 'event timeline panel', panel: 'Event Timeline', status: 'passed' }),
  ]),
  eventPipeline: Object.freeze([
    Object.freeze({ eventType: 'marketData.adapter.checked', status: 'healthy' }),
    Object.freeze({ eventType: 'broker.adapter.checked', status: 'healthy' }),
    Object.freeze({ eventType: 'system.releaseReadiness.evaluated', status: 'ready' }),
  ]),
  guardrails: Object.freeze([Object.freeze({ paperTrading: true })]),
  executions: Object.freeze([Object.freeze({ paperTrading: true })]),
})

describe('release candidate stabilization engine', () => {
  it('builds a regression checklist', () => {
    expect(buildRegressionChecklist(stableInput.regressionChecklist)).toMatchObject({
      name: 'regressionChecklist',
      status: 'stable',
      blockers: [],
    })

    expect(buildRegressionChecklist([
      { name: 'paper execution lifecycle', status: 'failed' },
    ])).toMatchObject({
      name: 'regressionChecklist',
      status: 'blocked',
      blockers: ['paper execution lifecycle'],
    })
  })

  it('summarizes critical module health', () => {
    expect(summarizeCriticalModuleHealth(stableInput.criticalModules)).toMatchObject({
      name: 'criticalModuleHealth',
      status: 'stable',
    })

    expect(summarizeCriticalModuleHealth([
      { name: 'broker adapter', status: 'caution' },
    ])).toMatchObject({
      name: 'criticalModuleHealth',
      status: 'caution',
      cautions: ['broker adapter'],
    })
  })

  it('summarizes dashboard smoke tests', () => {
    expect(summarizeDashboardSmokeTests(stableInput.dashboardSmokeTests)).toMatchObject({
      name: 'dashboardSmokeTests',
      status: 'stable',
    })

    expect(summarizeDashboardSmokeTests([
      { name: 'event timeline panel', panel: 'Event Timeline', status: 'failed' },
    ])).toMatchObject({
      name: 'dashboardSmokeTests',
      status: 'blocked',
      blockers: ['Event Timeline'],
    })
  })

  it('checks event pipeline integrity', () => {
    expect(checkEventPipelineIntegrity(stableInput.eventPipeline)).toMatchObject({
      name: 'eventPipelineIntegrity',
      status: 'stable',
    })

    expect(checkEventPipelineIntegrity([
      { eventType: 'broker.adapter.checked' },
      { eventType: null },
    ])).toMatchObject({
      name: 'eventPipelineIntegrity',
      status: 'blocked',
    })
  })

  it('verifies paper trading safety lock', () => {
    expect(verifyPaperTradingSafetyLock({
      releaseReadiness: stableInput.releaseReadiness,
      brokerHealth: stableInput.brokerHealth,
      guardrails: stableInput.guardrails,
      executions: stableInput.executions,
    })).toMatchObject({
      name: 'paperTradingSafetyLock',
      status: 'stable',
    })

    expect(verifyPaperTradingSafetyLock({
      releaseReadiness: stableInput.releaseReadiness,
      brokerHealth: { paperTrading: true, liveOrders: true },
      guardrails: stableInput.guardrails,
      executions: stableInput.executions,
    })).toMatchObject({
      name: 'paperTradingSafetyLock',
      status: 'blocked',
    })
  })

  it('verifies adapter mock mode', () => {
    expect(verifyAdapterMockMode(stableInput.adapters)).toMatchObject({
      name: 'adapterMockMode',
      status: 'stable',
    })

    expect(verifyAdapterMockMode([
      { name: 'Live Broker', provider: 'live-broker', paperTrading: true, liveOrders: false },
    ])).toMatchObject({
      name: 'adapterMockMode',
      status: 'blocked',
      blockers: ['Live Broker'],
    })
  })

  it('evaluates a stable release candidate', () => {
    const result = evaluateReleaseCandidateStabilization(stableInput, {
      emitEvent: false,
      timestamp: '2026-07-04T12:30:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_RELEASE_CANDIDATE_STABILIZED_EVENT)
    expect(result.finalStatus).toBe('stable')
    expect(result.stable).toBe(true)
    expect(result.releaseBlockers).toEqual([])
    expect(result.criticalModuleHealthSummary.status).toBe('stable')
  })

  it('emits stabilization events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_RELEASE_CANDIDATE_STABILIZED_EVENT, (payload) => events.push(payload))

    const result = createReleaseCandidateStabilizationEngine({ eventBus }).evaluate(stableInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_RELEASE_CANDIDATE_STABILIZED_EVENT)
  })
})
