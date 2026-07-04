import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  createPositionSizingEngine,
  recommendPositionSize,
  TRADE_POSITION_SIZE_RECOMMENDED_EVENT,
} from './positionSizingEngine.js'

const basePortfolioRisk = Object.freeze({
  account: {
    accountValue: 100000,
    cash: 50000,
    buyingPower: 50000,
  },
})

const clearDrawdownProtection = Object.freeze({
  protectionStatus: 'clear',
  recommendedAction: 'continue',
})

const approvedGuardrail = Object.freeze({
  decision: 'approved',
  reason: 'Trade passed all paper guardrails',
})

function trade(overrides = {}) {
  return {
    symbol: 'SPY',
    assetType: 'etf',
    side: 'buy',
    price: 100,
    stopPrice: 95,
    paperTrading: true,
    ...overrides,
  }
}

describe('positionSizingEngine', () => {
  it('recommends fixed-risk sizing before guardrail and execution', () => {
    const result = recommendPositionSize({}, trade(), {
      emitEvent: false,
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: clearDrawdownProtection,
      guardrailDecision: approvedGuardrail,
      limits: {
        fixedRiskAmount: 500,
        equityRiskPct: 1,
        maxRiskPerTradePct: 1,
        maxPositionValuePct: 20,
      },
    })

    expect(result.status).toBe('recommended')
    expect(result.paperTrading).toBe(true)
    expect(result.suggestedQuantity).toBe(100)
    expect(result.metrics.dollarRisk).toBe(500)
    expect(result.metrics.riskPct).toBe(0.5)
    expect(result.constraints.guardrailDecision).toBe('approved')
  })

  it('uses equity-based and max risk-per-trade caps for stop-distance sizing', () => {
    const result = recommendPositionSize({}, trade({ price: 50, stopPrice: 45 }), {
      emitEvent: false,
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: clearDrawdownProtection,
      limits: {
        equityRiskPct: 2,
        maxRiskPerTradePct: 1,
        maxPositionValuePct: 50,
      },
    })

    expect(result.status).toBe('recommended')
    expect(result.suggestedQuantity).toBe(200)
    expect(result.sizing.equityBasedQuantity).toBe(400)
    expect(result.sizing.stopDistanceQuantity).toBe(200)
    expect(result.metrics.dollarRisk).toBe(1000)
  })

  it('caps size by max position value', () => {
    const result = recommendPositionSize({}, trade({ price: 100, stopPrice: 99 }), {
      emitEvent: false,
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: clearDrawdownProtection,
      limits: {
        equityRiskPct: 1,
        maxRiskPerTradePct: 1,
        maxPositionValuePct: 5,
      },
    })

    expect(result.status).toBe('recommended')
    expect(result.sizing.stopDistanceQuantity).toBe(1000)
    expect(result.sizing.maxPositionValueQuantity).toBe(50)
    expect(result.suggestedQuantity).toBe(50)
    expect(result.metrics.notional).toBe(5000)
  })

  it('caps buy sizing by cash and buying power constraints', () => {
    const result = recommendPositionSize({}, trade({ price: 100, stopPrice: 99 }), {
      emitEvent: false,
      portfolioRisk: {
        account: {
          accountValue: 100000,
          cash: 1200,
          buyingPower: 5000,
        },
      },
      drawdownProtection: clearDrawdownProtection,
      limits: {
        equityRiskPct: 2,
        maxRiskPerTradePct: 2,
        maxPositionValuePct: 50,
      },
    })

    expect(result.status).toBe('recommended')
    expect(result.sizing.cashQuantity).toBe(12)
    expect(result.suggestedQuantity).toBe(12)
    expect(result.metrics.notional).toBe(1200)
  })

  it('supports asset-agnostic futures contract sizing', () => {
    const result = recommendPositionSize({}, trade({
      symbol: 'ES',
      assetType: 'futures',
      side: 'short',
      price: 5460,
      stopPrice: 5480,
    }), {
      emitEvent: false,
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: clearDrawdownProtection,
      limits: {
        equityRiskPct: 1,
        maxRiskPerTradePct: 1,
        maxPositionValuePct: 500,
      },
    })

    expect(result.status).toBe('recommended')
    expect(result.assetProfile.assetType).toBe('futures')
    expect(result.quantityTerm).toBe('contracts')
    expect(result.suggestedQuantity).toBe(1)
    expect(result.metrics.riskPerUnit).toBe(1000)
  })

  it('rejects sizing when proposed trade inputs are invalid', () => {
    const result = recommendPositionSize({}, trade({ symbol: '', price: 0, stopPrice: 0 }), {
      emitEvent: false,
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: clearDrawdownProtection,
    })

    expect(result.status).toBe('rejected')
    expect(result.suggestedQuantity).toBe(0)
    expect(result.errors).toContain('symbol is required')
    expect(result.errors).toContain('price must be greater than zero')
  })

  it('rejects sizing when drawdown protection is locked', () => {
    const result = recommendPositionSize({}, trade(), {
      emitEvent: false,
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: {
        protectionStatus: 'locked',
        recommendedAction: 'pause trading',
      },
    })

    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('drawdown protection is locked')
  })

  it('rejects sizing when a supplied guardrail decision is rejected', () => {
    const result = recommendPositionSize({}, trade(), {
      emitEvent: false,
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: clearDrawdownProtection,
      guardrailDecision: {
        decision: 'rejected',
        reason: 'Trade risk exceeds per-trade limit',
      },
    })

    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('guardrail rejected proposed trade')
    expect(result.constraints.guardrailDecision).toBe('rejected')
  })

  it('emits the position size recommendation event', () => {
    const eventBus = createEventBus()
    const events = []

    eventBus.subscribe(TRADE_POSITION_SIZE_RECOMMENDED_EVENT, (payload) => events.push(payload))

    const result = createPositionSizingEngine({ eventBus }).recommend({}, trade(), {
      portfolioRisk: basePortfolioRisk,
      drawdownProtection: clearDrawdownProtection,
      timestamp: '2026-07-03T18:00:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0]).toMatchObject({
      eventType: TRADE_POSITION_SIZE_RECOMMENDED_EVENT,
      timestamp: '2026-07-03T18:00:00.000Z',
      paperTrading: true,
    })
  })
})
