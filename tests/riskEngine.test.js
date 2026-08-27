import { describe, expect, it } from 'vitest'
import { createRiskEngine } from '../lib/risk/riskEngine.js'
import { createPositionSizingEngine } from '../lib/risk/positionSizingEngine.js'
import { createKillSwitchEngine } from '../lib/risk/killSwitchEngine.js'
import { createWorkspaceDataService } from '../lib/workspace/workspaceDataService.js'

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

  it('caps position size by order notional', () => {
    const sizing = createPositionSizingEngine()
    const result = sizing.sizeOrder({ accountBalance: 10000, riskPerTrade: 0.01, price: 100, stopDistance: 5 })

    expect(result).toBe(5)
  })

  it('returns zero when one SPY share exceeds the notional cap', () => {
    const sizing = createPositionSizingEngine()
    expect(sizing.sizeOrder({ accountBalance: 100000, riskPerTrade: 0.01, price: 771.28, stopDistance: 15.43 })).toBe(0)
  })

  it('uses risk quantity when it is smaller than notional quantity', () => {
    const sizing = createPositionSizingEngine()
    expect(sizing.sizeOrder({ accountBalance: 1000, riskPerTrade: 0.01, price: 100, stopDistance: 5 })).toBe(2)
  })

  it('uses notional quantity when it is smaller than risk quantity', () => {
    const sizing = createPositionSizingEngine()
    expect(sizing.sizeOrder({ accountBalance: 100000, riskPerTrade: 0.01, price: 200, stopDistance: 4 })).toBe(2)
  })

  it('preserves zero through the server sizing caller and fails closed', async () => {
    const quote = { symbol: 'SPY', price: 771.28, updatedAt: new Date().toISOString(), assetType: 'equity' }
    const service = createWorkspaceDataService({
      marketDataService: { getQuote: async () => quote },
      portfolioRepository: { list: () => [{ cash: 100000, exposure: 0.1 }] },
    })
    const result = await service.getRiskSummary('SPY')
    expect(result.risk.requestedPositionSize).toBe(0)
    expect(result.risk.positionSize).toBe(0)
    expect(result.risk.approved).toBe(false)
    expect(result.risk.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'quantity', passed: false }),
    ]))
  })

  it('manages the kill switch state', () => {
    const killSwitch = createKillSwitchEngine(false)
    expect(killSwitch.isActive()).toBe(false)
    killSwitch.activate()
    expect(killSwitch.isActive()).toBe(true)
  })
})
