import { describe, expect, it } from 'vitest'
import { createIndexPullbackExitPolicy } from '../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'
import { simulatePaperPositionExit } from '../lib/opportunities/paperExit/paperExitEngine.js'

// Synthetic arithmetic fixtures only. No database, network, or EDGE.2 collector.
const now = '2026-09-22T19:00:00.000Z'
const enteredAt = '2026-09-21T14:00:00.000Z'
function calculate({ side = 'long', bar = {}, sessionsHeld = 0, quotePrice = 110, liquidityScore = 80, ...input } = {}) {
  const exitPolicy = createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', side, entryPrice: 100, stopPrice: side === 'long' ? 98 : 102, targetPrice: side === 'long' ? 104 : 96, enteredAt })
  return simulatePaperPositionExit({
    position: { positionId: 'synthetic-pa4', symbol: 'SPY', assetType: 'etf', side, quantity: 10, averagePrice: 100, exitPolicy },
    account: { cash: 99000, equity: 100000, realizedPnl: 0 }, quantity: 10,
    quote: { price: quotePrice, updatedAt: now, liquidityScore },
    policyBar: { open: 100, high: 101, low: 99, close: 100, observedAt: now, freshness: 'FRESH', ...bar },
    sessionsHeld, ...input,
  }, { now })
}

describe('PA.4 prescribed price and unchanged deterministic costs (synthetic calculation)', () => {
  it.each([
    ['long', { low: 97 }, 0, 'initial_stop', 98],
    ['long', { high: 105 }, 0, 'profit_target', 104],
    ['long', { high: 105, low: 97 }, 0, 'same_bar_stop_target_stop_first', 98],
    ['long', { open: 95, high: 96, low: 94, close: 95 }, 0, 'stop_gap', 95],
    ['long', { open: 106, high: 108, low: 105, close: 107 }, 0, 'target_gap', 104],
    ['long', { close: 101 }, 20, 'maximum_holding_period', 101],
    ['short', { high: 103 }, 0, 'initial_stop', 102],
    ['short', { low: 95 }, 0, 'profit_target', 96],
    ['short', { high: 103, low: 95 }, 0, 'same_bar_stop_target_stop_first', 102],
    ['short', { open: 105, high: 106, low: 104, close: 105 }, 0, 'stop_gap', 105],
    ['short', { open: 94, high: 95, low: 93, close: 94 }, 0, 'target_gap', 96],
    ['short', { close: 99 }, 20, 'maximum_holding_period', 99],
  ])('%s %j uses policy price, then slippage and fees', (side, bar, sessionsHeld, reason, price) => {
    const result = calculate({ side, bar, sessionsHeld })
    const fill = Number((price * (side === 'long' ? 0.9995 : 1.0005)).toFixed(2))
    const fees = Number(Math.max(0.25, fill * 10 * 0.0005).toFixed(2))
    const pnl = Number(((side === 'long' ? fill - 100 : 100 - fill) * 10 - fees).toFixed(2))
    expect(result).toMatchObject({ status: 'POSITION_CLOSED', automaticExecution: false, liveOrders: false, brokerExecution: false })
    expect(result.exitPlan).toMatchObject({ referencePrice: price, policyExitPrice: price, currentQuotePrice: 110, policyTrigger: reason, simulatedExitPrice: fill, fees, slippageBps: 5, realizedPnlDelta: pnl })
    expect(result.accountSnapshot.realizedPnl).toBe(pnl)
    expect(result.accountSnapshot.cash).toBeCloseTo(99000 + (side === 'long' ? fill * 10 : -fill * 10) - fees, 2)
    expect(calculate({ side, bar, sessionsHeld, quotePrice: 90 }).exitPlan.simulatedExitPrice).toBe(fill)
  })

  it('retains the low-liquidity surcharge without repricing from the later quote', () => {
    const result = calculate({ bar: { low: 97 }, liquidityScore: 40 })
    expect(result.exitPlan).toMatchObject({ referencePrice: 98, slippageBps: 9, simulatedExitPrice: 97.91 })
  })

  it.each([
    { policyBar: undefined },
    { bar: { freshness: 'STALE', low: 97 } },
    { bar: { observedAt: '2026-09-22T18:00:00.000Z', low: 97 } },
    { bar: { observedAt: '2026-09-22T20:00:00.000Z', low: 97 } },
    { bar: { high: 95, low: 97 } },
    { bar: { low: null } },
    { policyBar: undefined, sessionsHeld: 200 },
  ])('rejects missing/stale/invalid bars without quote-to-OHLC fabrication: %j', (input) => {
    const result = calculate(input)
    expect(result.status).toBe('REJECTED')
    expect(result.accountSnapshot).toBeUndefined()
    expect(result.exitAttribution.policyCompliant).toBe(false)
  })

  it('keeps emergency execution quote-based and non-compliant', () => {
    const result = calculate({ exitReason: 'manual_emergency', bar: { low: 97 }, sessionsHeld: 200 })
    expect(result.exitAttribution).toMatchObject({ policyCompliant: false, countsTowardObservationMinimum: false })
    expect(result.exitPlan).toMatchObject({ referencePrice: 110, policyExitPrice: null, policyTrigger: null, simulatedExitPrice: 109.94 })
  })
})
