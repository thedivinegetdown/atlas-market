import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  PORTFOLIO_ACCOUNTING_UPDATED_EVENT,
  applyPaperPortfolioAccounting,
  createPaperPortfolioAccountingEngine,
} from './paperPortfolioAccountingEngine.js'

function filledExecution(fillOverrides = {}) {
  const fill = {
    symbol: 'SPY',
    assetType: 'etf',
    side: 'buy',
    orderType: 'limit',
    quantity: 10,
    quantityTerm: 'shares',
    referencePrice: 100,
    fillPrice: 100,
    slippageBps: 2,
    slippageAmount: 0.2,
    fees: 1,
    notional: 1000,
    cashImpact: -1001,
    ...fillOverrides,
  }

  return {
    portfolioId: 'paper-accounting-test',
    finalStatus: 'filled',
    fill,
  }
}

describe('paperPortfolioAccountingEngine', () => {
  it('creates a new position and updates cash and equity from a filled buy', () => {
    const result = applyPaperPortfolioAccounting({
      id: 'paper-accounting-test',
      cash: 10000,
      accountValue: 10000,
      positions: [],
    }, filledExecution(), { emitEvent: false })

    expect(result.status).toBe('position_created')
    expect(result.account.cash).toBe(8999)
    expect(result.account.equity).toBe(9999)
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0]).toMatchObject({
      symbol: 'SPY',
      quantity: 10,
      averagePrice: 100,
    })
  })

  it('increases an existing position and recalculates average price', () => {
    const result = applyPaperPortfolioAccounting({
      id: 'paper-accounting-test',
      cash: 10000,
      accountValue: 15000,
      positions: [{ symbol: 'SPY', assetType: 'etf', side: 'long', quantity: 10, averagePrice: 90, currentPrice: 100 }],
    }, filledExecution({ quantity: 10, fillPrice: 110, notional: 1100, cashImpact: -1101 }), { emitEvent: false })

    expect(result.status).toBe('position_increased')
    expect(result.positions[0].quantity).toBe(20)
    expect(result.positions[0].averagePrice).toBe(100)
    expect(result.account.cash).toBe(8899)
  })

  it('reduces an existing position and records realized P&L', () => {
    const result = applyPaperPortfolioAccounting({
      id: 'paper-accounting-test',
      cash: 5000,
      accountValue: 7000,
      realizedPnl: 10,
      positions: [{ symbol: 'SPY', assetType: 'etf', side: 'long', quantity: 20, averagePrice: 90, currentPrice: 100 }],
    }, filledExecution({
      side: 'sell',
      quantity: 5,
      fillPrice: 100,
      fees: 1,
      notional: 500,
      cashImpact: 499,
    }), { emitEvent: false })

    expect(result.status).toBe('position_reduced')
    expect(result.positions[0].quantity).toBe(15)
    expect(result.account.realizedPnlDelta).toBe(49)
    expect(result.account.realizedPnl).toBe(59)
    expect(result.account.cash).toBe(5499)
  })

  it('fully closes a position', () => {
    const result = applyPaperPortfolioAccounting({
      id: 'paper-accounting-test',
      cash: 5000,
      accountValue: 6000,
      positions: [{ symbol: 'SPY', assetType: 'etf', side: 'long', quantity: 10, averagePrice: 90, currentPrice: 100 }],
    }, filledExecution({
      side: 'sell',
      quantity: 10,
      fillPrice: 100,
      fees: 1,
      notional: 1000,
      cashImpact: 999,
    }), { emitEvent: false })

    expect(result.status).toBe('position_closed')
    expect(result.positions).toEqual([])
    expect(result.account.realizedPnlDelta).toBe(99)
    expect(result.account.equity).toBe(5999)
  })

  it('handles short position accounting with cover realized P&L', () => {
    const result = applyPaperPortfolioAccounting({
      id: 'paper-accounting-test',
      cash: 12000,
      accountValue: 10000,
      positions: [{ symbol: 'ES', assetType: 'futures', side: 'short', quantity: 1, averagePrice: 5000, currentPrice: 4980 }],
    }, filledExecution({
      symbol: 'ES',
      assetType: 'futures',
      side: 'cover',
      quantity: 1,
      quantityTerm: 'contracts',
      fillPrice: 4970,
      fees: 2,
      notional: 248500,
      cashImpact: -248502,
    }), { emitEvent: false })

    expect(result.status).toBe('position_closed')
    expect(result.account.realizedPnlDelta).toBe(1498)
  })

  it('rejects accounting when execution is not filled', () => {
    const result = applyPaperPortfolioAccounting({
      id: 'paper-accounting-test',
      cash: 10000,
      accountValue: 10000,
      positions: [],
    }, {
      finalStatus: 'rejected',
      fill: null,
    }, { emitEvent: false })

    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('not filled')
    expect(result.positions).toEqual([])
  })

  it('emits portfolio.accounting.updated', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_ACCOUNTING_UPDATED_EVENT, (payload) => events.push(payload))

    const result = createPaperPortfolioAccountingEngine({ eventBus }).apply({
      id: 'paper-accounting-test',
      cash: 10000,
      accountValue: 10000,
      positions: [],
    }, filledExecution())

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(PORTFOLIO_ACCOUNTING_UPDATED_EVENT)
    expect(events[0].account.cash).toBe(result.account.cash)
  })
})
