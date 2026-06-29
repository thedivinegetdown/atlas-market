import { describe, expect, it } from 'vitest'
import { createRiskEngine } from '../lib/risk/riskEngine.js'
import { createPositionSizingEngine } from '../lib/risk/positionSizingEngine.js'
import { createKillSwitchEngine } from '../lib/risk/killSwitchEngine.js'

describe('risk engine', () => {
  it('approves a safe order', () => {
    const engine = createRiskEngine()
    const decision = engine.evaluateOrder({ quantity: 10, price: 20 }, { exposure: 0.1 }, {
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
    })

    expect(decision.approved).toBe(true)
    expect(decision.reason).toBe('order approved')
  })

  it('blocks an invalid quantity', () => {
    const engine = createRiskEngine()
    const decision = engine.evaluateOrder({ quantity: 0, price: 20 }, { exposure: 0.1 }, {
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
    })

    expect(decision.approved).toBe(false)
    expect(decision.checks.some((check) => check.name === 'quantity' && !check.passed)).toBe(true)
  })

  it('blocks an order that exceeds the max notional', () => {
    const engine = createRiskEngine()
    const decision = engine.evaluateOrder({ quantity: 200, price: 10 }, { exposure: 0.1 }, {
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
    })

    expect(decision.approved).toBe(false)
    expect(decision.checks.some((check) => check.name === 'orderNotional' && !check.passed)).toBe(true)
  })

  it('blocks orders when the kill switch is active', () => {
    const engine = createRiskEngine({ killSwitch: true })
    const decision = engine.evaluateOrder({ quantity: 5, price: 20 }, { exposure: 0.1 }, {
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
    })

    expect(decision.approved).toBe(false)
    expect(decision.checks.some((check) => check.name === 'killSwitch' && !check.passed)).toBe(true)
  })

  it('blocks stale quote data', () => {
    const engine = createRiskEngine()
    const decision = engine.evaluateOrder({ quantity: 5, price: 20 }, { exposure: 0.1 }, {
      updatedAt: new Date(Date.now() - 200_000).toISOString(),
    })

    expect(decision.approved).toBe(false)
    expect(decision.checks.some((check) => check.name === 'marketDataFreshness' && !check.passed)).toBe(true)
  })

  it('sizes positions using risk limits', () => {
    const sizing = createPositionSizingEngine()
    const result = sizing.sizeOrder({ accountBalance: 10000, riskPerTrade: 0.01, price: 100, stopDistance: 5 })

    expect(result).toBe(20)
  })

  it('manages the kill switch state', () => {
    const killSwitch = createKillSwitchEngine(false)
    expect(killSwitch.isActive()).toBe(false)
    killSwitch.activate()
    expect(killSwitch.isActive()).toBe(true)
  })
})
