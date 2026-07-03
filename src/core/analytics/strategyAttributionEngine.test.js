import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  STRATEGY_ATTRIBUTION_EVALUATED_EVENT,
  createStrategyAttributionEngine,
  evaluateStrategyAttribution,
} from './strategyAttributionEngine.js'

function journalRecord(overrides = {}) {
  return {
    tradeId: 'trade-1',
    paperTrading: true,
    journalStatus: 'recorded',
    symbol: 'SPY',
    strategy: 'Breakout',
    realizedPnl: 100,
    fill: { fillPrice: 100 },
    decisionGate: {
      guardrail: 'approved',
      execution: 'filled',
      accounting: 'position_closed',
    },
    proposedTradeSnapshot: {
      strategy: 'Breakout',
    },
    ...overrides,
  }
}

describe('strategyAttributionEngine', () => {
  it('attributes paper performance by strategy', () => {
    const result = evaluateStrategyAttribution([
      journalRecord({ tradeId: 'breakout-win', strategy: 'Breakout', realizedPnl: 120 }),
      journalRecord({ tradeId: 'breakout-loss', strategy: 'Breakout', realizedPnl: -40 }),
      journalRecord({ tradeId: 'mean-reversion-win', strategy: 'Mean Reversion', symbol: 'AAPL', realizedPnl: 60 }),
    ], { emitEvent: false, timestamp: '2026-07-03T18:00:00Z' })

    const breakout = result.strategies.find((strategy) => strategy.strategy === 'Breakout')
    const meanReversion = result.strategies.find((strategy) => strategy.strategy === 'Mean Reversion')

    expect(result.eventType).toBe(STRATEGY_ATTRIBUTION_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.attributedStrategies).toBe(2)
    expect(breakout).toMatchObject({
      trades: 2,
      winRate: 50,
      netRealizedPnl: 80,
      averageWin: 120,
      averageLoss: -40,
      profitFactor: 3,
      expectancy: 40,
    })
    expect(meanReversion).toMatchObject({
      trades: 1,
      winRate: 100,
      netRealizedPnl: 60,
    })
  })

  it('excludes rejected and non-filled trades per strategy', () => {
    const result = evaluateStrategyAttribution([
      journalRecord({ tradeId: 'included', strategy: 'Breakout', realizedPnl: 75 }),
      journalRecord({ tradeId: 'rejected', strategy: 'Breakout', journalStatus: 'rejected', fill: null, realizedPnl: 500 }),
      journalRecord({ tradeId: 'not-filled', strategy: 'Momentum', decisionGate: { execution: 'not_filled', accounting: 'rejected' }, realizedPnl: -500 }),
    ], { emitEvent: false })
    const breakout = result.strategies.find((strategy) => strategy.strategy === 'Breakout')
    const momentum = result.strategies.find((strategy) => strategy.strategy === 'Momentum')

    expect(breakout.trades).toBe(1)
    expect(breakout.excludedTrades).toBe(1)
    expect(momentum.trades).toBe(0)
    expect(momentum.excludedTrades).toBe(1)
    expect(result.excludedTrades).toBe(2)
  })

  it('falls back to proposed trade signal when strategy is missing', () => {
    const result = evaluateStrategyAttribution([
      journalRecord({
        strategy: undefined,
        proposedTradeSnapshot: { signal: 'Signal Engine Buy' },
      }),
    ], { emitEvent: false })

    expect(result.strategies[0].strategy).toBe('Signal Engine Buy')
  })

  it('emits strategy.attribution.evaluated', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_ATTRIBUTION_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyAttributionEngine({ eventBus }).evaluate([
      journalRecord({ tradeId: 'trade-1', realizedPnl: 25 }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(STRATEGY_ATTRIBUTION_EVALUATED_EVENT)
    expect(events[0].strategies[0].netRealizedPnl).toBe(result.strategies[0].netRealizedPnl)
  })
})
