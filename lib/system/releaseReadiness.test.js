import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_RELEASE_READINESS_EVALUATED_EVENT,
  createReleaseReadinessEngine,
  evaluateReleaseReadiness,
  validateAdapterHealth,
  validateEventContracts,
  validatePaperTradingSafety,
  validateReleaseEnvironment,
  validateTestBuildStatus,
} from './releaseReadiness.js'

const healthyAdapters = Object.freeze([
  Object.freeze({
    name: 'Market Data',
    provider: 'mock-market-data-adapter',
    status: 'healthy',
    paperTrading: true,
    liveOrders: false,
  }),
  Object.freeze({
    name: 'Broker Adapter',
    provider: 'mock-paper-broker-adapter',
    status: 'healthy',
    paperTrading: true,
    liveOrders: false,
  }),
])

const eventContracts = Object.freeze([
  Object.freeze({ expected: 'marketData.adapter.checked', actual: 'marketData.adapter.checked' }),
  Object.freeze({ expected: 'broker.adapter.checked', actual: 'broker.adapter.checked' }),
  Object.freeze({ expected: 'trade.guardrail.evaluated', actual: 'trade.guardrail.evaluated' }),
])

describe('release readiness engine', () => {
  it('validates a paper trading environment', () => {
    const check = validateReleaseEnvironment({
      NODE_ENV: 'production',
      TRADING_MODE: 'paper',
      DATABASE_URL: 'postgres://release-candidate',
    })

    expect(check.status).toBe('ready')
    expect(check).toMatchObject({
      name: 'environment',
      tradingMode: 'paper',
      databaseConfigured: true,
    })
  })

  it('blocks unsafe trading modes', () => {
    const check = validateReleaseEnvironment({
      NODE_ENV: 'production',
      TRADING_MODE: 'live',
      DATABASE_URL: 'postgres://release-candidate',
    })

    expect(check.status).toBe('blocked')
    expect(check.message).toBe('server configuration is invalid')
  })

  it('validates adapter health and paper-only broker state', () => {
    expect(validateAdapterHealth(healthyAdapters)).toMatchObject({
      name: 'adapterHealth',
      status: 'ready',
    })

    expect(validateAdapterHealth([
      { name: 'Broker Adapter', status: 'healthy', paperTrading: true, liveOrders: true },
    ])).toMatchObject({
      name: 'adapterHealth',
      status: 'blocked',
    })
  })

  it('validates event contracts', () => {
    expect(validateEventContracts(eventContracts)).toMatchObject({
      name: 'eventContracts',
      status: 'ready',
      contractCount: 3,
    })

    expect(validateEventContracts([
      { expected: 'broker.adapter.checked', actual: 'marketData.adapter.checked' },
    ])).toMatchObject({
      name: 'eventContracts',
      status: 'blocked',
    })
  })

  it('validates paper trading safety across lifecycle outputs', () => {
    expect(validatePaperTradingSafety({
      tradingMode: 'paper',
      brokerHealth: { paperTrading: true, liveOrders: false },
      guardrails: [{ paperTrading: true }],
      executions: [{ paperTrading: true }],
    })).toMatchObject({
      name: 'paperTradingSafety',
      status: 'ready',
    })

    expect(validatePaperTradingSafety({
      tradingMode: 'paper',
      brokerHealth: { paperTrading: true, liveOrders: false },
      guardrails: [{ paperTrading: false }],
      executions: [{ paperTrading: true }],
    })).toMatchObject({
      name: 'paperTradingSafety',
      status: 'blocked',
    })
  })

  it('summarizes test and build validation', () => {
    expect(validateTestBuildStatus({
      tests: { status: 'passed', command: 'npm test' },
      build: { status: 'passed', command: 'npm run build' },
    })).toMatchObject({
      name: 'testBuildStatus',
      status: 'ready',
    })

    expect(validateTestBuildStatus({
      tests: { status: 'failed' },
      build: { status: 'passed' },
    })).toMatchObject({
      name: 'testBuildStatus',
      status: 'blocked',
    })
  })

  it('evaluates a ready release candidate', () => {
    const result = evaluateReleaseReadiness({
      env: { NODE_ENV: 'production', TRADING_MODE: 'paper', DATABASE_URL: 'postgres://release-candidate' },
      adapters: healthyAdapters,
      brokerHealth: { paperTrading: true, liveOrders: false },
      eventContracts,
      guardrails: [{ paperTrading: true }],
      executions: [{ paperTrading: true }],
      validation: {
        tests: { status: 'passed', summary: '285 tests passed' },
        build: { status: 'passed', summary: 'vite build passed' },
      },
    }, { emitEvent: false, timestamp: '2026-07-04T12:00:00.000Z' })

    expect(result.eventType).toBe(SYSTEM_RELEASE_READINESS_EVALUATED_EVENT)
    expect(result.releaseReadinessStatus).toBe('ready')
    expect(result.ready).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('emits readiness events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_RELEASE_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createReleaseReadinessEngine({ eventBus }).evaluate({
      env: { NODE_ENV: 'development', TRADING_MODE: 'paper' },
      adapters: healthyAdapters,
      brokerHealth: { paperTrading: true, liveOrders: false },
      eventContracts,
      guardrails: [{ paperTrading: true }],
      executions: [{ paperTrading: true }],
      validation: {
        tests: { status: 'passed' },
        build: { status: 'passed' },
      },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_RELEASE_READINESS_EVALUATED_EVENT)
  })
})
