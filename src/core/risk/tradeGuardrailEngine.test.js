import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { demoPortfolio, demoProposedTrades, guardrailDemoPortfolio } from '../../data/demoPortfolio.js'
import {
  TRADE_GUARDRAIL_EVALUATED_EVENT,
  createTradeGuardrailEngine,
  evaluateTradeGuardrail,
} from './tradeGuardrailEngine.js'

describe('tradeGuardrailEngine', () => {
  it('approves a controlled asset-agnostic paper trade', () => {
    const result = evaluateTradeGuardrail(guardrailDemoPortfolio, demoProposedTrades[0], {
      emitEvent: false,
      timestamp: '2026-07-03T14:30:00Z',
    })

    expect(result.eventType).toBe(TRADE_GUARDRAIL_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.approved).toBe(true)
    expect(result.decision).toBe('approved')
    expect(result.proposedTrade.symbol).toBe('SPY')
    expect(result.assetProfile.quantityTerm).toBe('shares')
    expect(result.checks.every((check) => check.passed)).toBe(true)
  })

  it('rejects invalid proposed trade payloads before lifecycle entry', () => {
    const result = evaluateTradeGuardrail(guardrailDemoPortfolio, {
      symbol: '',
      assetType: 'equity',
      side: 'buy',
      quantity: 0,
      price: 100,
      stopPrice: 98,
      paperTrading: true,
    }, { emitEvent: false })

    expect(result.approved).toBe(false)
    expect(result.decision).toBe('rejected')
    expect(result.failedChecks.map((check) => check.name)).toContain('proposed_trade_validation')
  })

  it('rejects trades over max risk per trade', () => {
    const result = evaluateTradeGuardrail(guardrailDemoPortfolio, {
      symbol: 'AAPL',
      assetType: 'equity',
      side: 'buy',
      orderType: 'limit',
      quantity: 500,
      price: 190,
      stopPrice: 180,
      paperTrading: true,
    }, { emitEvent: false })

    expect(result.approved).toBe(false)
    expect(result.failedChecks.map((check) => check.name)).toContain('max_risk_per_trade')
  })

  it('rejects trades that push portfolio heat beyond limits', () => {
    const result = evaluateTradeGuardrail(demoPortfolio, demoProposedTrades[1], { emitEvent: false })

    expect(result.approved).toBe(false)
    expect(result.failedChecks.map((check) => check.name)).toContain('max_portfolio_heat_after_trade')
  })

  it('rejects trades without sufficient buying power or cash', () => {
    const result = evaluateTradeGuardrail({
      id: 'cash-light',
      accountValue: 50000,
      cash: 1000,
      buyingPower: 1000,
      positions: [],
    }, {
      symbol: 'MSFT',
      assetType: 'equity',
      side: 'buy',
      orderType: 'market',
      quantity: 20,
      price: 400,
      stopPrice: 392,
      paperTrading: true,
    }, { emitEvent: false })

    expect(result.approved).toBe(false)
    expect(result.failedChecks.map((check) => check.name)).toEqual(expect.arrayContaining(['buying_power', 'cash']))
  })

  it('enforces paper trading mode and emits trade.guardrail.evaluated', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(TRADE_GUARDRAIL_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createTradeGuardrailEngine({ eventBus }).evaluate(guardrailDemoPortfolio, {
      ...demoProposedTrades[0],
      paperTrading: false,
    })

    expect(result.approved).toBe(false)
    expect(result.failedChecks.map((check) => check.name)).toContain('paper_trading')
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(TRADE_GUARDRAIL_EVALUATED_EVENT)
  })
})
