import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_OPERATOR_ACTIONS_GENERATED_EVENT,
  createOperatorActionCenterEngine,
  generateOperatorActions,
} from './operatorActionCenterEngine.js'

const stableInput = Object.freeze({
  systemHealthCommandCenter: Object.freeze({
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
    summary: 'System health command center operational.',
    moduleHealthRegistry: Object.freeze([]),
  }),
  eventObservability: Object.freeze({
    eventType: 'system.events.observed',
    observabilityStatus: 'healthy',
    missingEventDetection: Object.freeze({ missingCount: 0 }),
    duplicateEventDetection: Object.freeze({ duplicateCount: 0 }),
  }),
  portfolioOptimizationGovernance: Object.freeze({
    eventType: 'portfolio.optimizationGovernance.reviewed',
    governanceStatus: 'approved',
    summary: 'Governance approved.',
  }),
  drawdownProtection: Object.freeze({
    eventType: 'portfolio.drawdownProtection.evaluated',
    protectionStatus: 'clear',
    recommendedAction: 'continue',
  }),
  portfolioRisk: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    summary: Object.freeze({ riskLevel: 'controlled', riskScore: 22, grossExposure: 82 }),
  }),
  marketDataAdapterHealth: Object.freeze({
    eventType: 'marketData.adapter.checked',
    health: Object.freeze({ status: 'healthy' }),
  }),
  brokerAdapterHealth: Object.freeze({
    eventType: 'broker.adapter.checked',
    health: Object.freeze({ status: 'healthy', paperTrading: true, liveOrders: false }),
  }),
  releaseReadiness: Object.freeze({
    eventType: 'system.releaseReadiness.evaluated',
    releaseReadinessStatus: 'ready',
  }),
})

describe('operator action center engine', () => {
  it('generates low-severity approve actions for stable paper-only operations', () => {
    const result = generateOperatorActions(stableInput, {
      emitEvent: false,
      timestamp: '2026-07-08T13:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_OPERATOR_ACTIONS_GENERATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.humanReviewOnly).toBe(true)
    expect(result.prioritizedOperatorActions.some((action) => action.category === 'approve')).toBe(true)
    expect(result.platformActionSummary.bySeverity.critical).toBe(0)
    expect(result.platformActionSummary.humanReviewOnly).toBe(true)
  })

  it('prioritizes critical pause and investigate actions when upstream outputs are degraded', () => {
    const result = generateOperatorActions({
      ...stableInput,
      systemHealthCommandCenter: {
        ...stableInput.systemHealthCommandCenter,
        finalPlatformHealthStatus: 'degraded',
        moduleHealthRegistry: [
          { id: 'broker-adapter', name: 'Broker Adapter', healthStatus: 'degraded', eventType: 'broker.adapter.checked' },
        ],
      },
      eventObservability: {
        ...stableInput.eventObservability,
        observabilityStatus: 'degraded',
        missingEventDetection: { missingCount: 2 },
        duplicateEventDetection: { duplicateCount: 1 },
      },
      portfolioOptimizationGovernance: {
        ...stableInput.portfolioOptimizationGovernance,
        governanceStatus: 'rejected',
      },
      drawdownProtection: {
        ...stableInput.drawdownProtection,
        protectionStatus: 'locked',
        recommendedAction: 'pause trading',
      },
      portfolioRisk: {
        ...stableInput.portfolioRisk,
        summary: { riskLevel: 'critical', riskScore: 92, grossExposure: 138 },
      },
      brokerAdapterHealth: {
        ...stableInput.brokerAdapterHealth,
        health: { status: 'healthy', paperTrading: false, liveOrders: true },
      },
      releaseReadiness: {
        ...stableInput.releaseReadiness,
        releaseReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.prioritizedOperatorActions[0].severity).toBe('critical')
    expect(result.prioritizedOperatorActions.some((action) => action.category === 'pause')).toBe(true)
    expect(result.prioritizedOperatorActions.some((action) => action.category === 'investigate')).toBe(true)
    expect(result.platformActionSummary.bySeverity.critical).toBeGreaterThan(0)
    expect(result.sourceEvents.brokerAdapter).toBe('broker.adapter.checked')
  })

  it('creates reduce risk actions from drawdown and portfolio risk cautions', () => {
    const result = generateOperatorActions({
      ...stableInput,
      drawdownProtection: {
        ...stableInput.drawdownProtection,
        protectionStatus: 'caution',
        currentDrawdown: 8,
        maxDrawdownThreshold: 10,
      },
      portfolioRisk: {
        ...stableInput.portfolioRisk,
        summary: { riskLevel: 'elevated', riskScore: 40, grossExposure: 104 },
      },
    }, { emitEvent: false })

    expect(result.prioritizedOperatorActions.filter((action) => action.category === 'reduce risk')).toHaveLength(2)
    expect(result.platformActionSummary.byCategory['reduce risk']).toBe(2)
  })

  it('emits system operator actions generated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_OPERATOR_ACTIONS_GENERATED_EVENT, (payload) => events.push(payload))

    const result = createOperatorActionCenterEngine({ eventBus }).generate(stableInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_OPERATOR_ACTIONS_GENERATED_EVENT)
  })
})
