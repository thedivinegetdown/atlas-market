import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  createDrawdownProtectionEngine,
  evaluateDrawdownProtection,
  PORTFOLIO_DRAWDOWN_PROTECTION_EVALUATED_EVENT,
} from './drawdownProtectionEngine.js'

function journalRecord(overrides = {}) {
  return {
    tradeId: overrides.tradeId ?? 'trade-1',
    symbol: overrides.symbol ?? 'SPY',
    paperTrading: true,
    journalStatus: 'recorded',
    realizedPnl: overrides.realizedPnl ?? 0,
    timestamp: overrides.timestamp ?? '2026-07-03T12:00:00.000Z',
    fill: { fillPrice: 100 },
    decisionGate: {
      guardrail: 'approved',
      execution: 'filled',
      accounting: 'updated',
    },
  }
}

function riskAdjustedSnapshot(overrides = {}) {
  return {
    startingEquity: overrides.startingEquity ?? 100000,
    returnSeries: overrides.returnSeries ?? [
      {
        tradeId: 'trade-1',
        symbol: 'SPY',
        realizedPnl: 500,
        startingEquity: 100000,
        endingEquity: 100500,
        returnPct: 0.5,
      },
    ],
    drawdownSeries: overrides.drawdownSeries ?? [
      { tradeId: 'trade-1', equity: 100500, drawdownPct: 0 },
    ],
    metrics: {
      riskAdjustedGrade: overrides.riskAdjustedGrade ?? 'B',
      maxDrawdown: overrides.maxDrawdown ?? 0,
    },
  }
}

describe('drawdownProtectionEngine', () => {
  it('returns clear status when drawdown and loss windows are inside limits', () => {
    const result = evaluateDrawdownProtection(
      { account: { equity: 100500 } },
      [journalRecord({ tradeId: 'trade-1', realizedPnl: 500 })],
      {
        emitEvent: false,
        timestamp: '2026-07-03T16:00:00.000Z',
        riskAdjustedPerformance: riskAdjustedSnapshot(),
      },
    )

    expect(result.paperTrading).toBe(true)
    expect(result.protectionStatus).toBe('clear')
    expect(result.recommendedAction).toBe('continue')
    expect(result.currentDrawdown).toBe(0)
    expect(result.dailyLoss.pct).toBe(0)
  })

  it('recommends reducing risk when drawdown is near the max threshold', () => {
    const result = evaluateDrawdownProtection(
      { account: { equity: 92500 } },
      [journalRecord({ tradeId: 'trade-1', realizedPnl: -500 })],
      {
        emitEvent: false,
        equityPeak: 100000,
        maxDrawdownThreshold: 10,
        dailyLossThreshold: 3,
        weeklyLossThreshold: 6,
        riskAdjustedPerformance: riskAdjustedSnapshot({
          returnSeries: [{ tradeId: 'trade-1', realizedPnl: -500, endingEquity: 99500 }],
          drawdownSeries: [{ tradeId: 'trade-1', equity: 99500, drawdownPct: 0.5 }],
          maxDrawdown: 0.5,
        }),
      },
    )

    expect(result.protectionStatus).toBe('caution')
    expect(result.recommendedAction).toBe('reduce risk')
    expect(result.currentDrawdown).toBe(7.5)
  })

  it('locks trading when current drawdown exceeds the max threshold', () => {
    const result = evaluateDrawdownProtection(
      { account: { equity: 88000 } },
      [journalRecord({ tradeId: 'trade-1', realizedPnl: -500 })],
      {
        emitEvent: false,
        equityPeak: 100000,
        maxDrawdownThreshold: 10,
        riskAdjustedPerformance: riskAdjustedSnapshot({
          returnSeries: [{ tradeId: 'trade-1', realizedPnl: -500, endingEquity: 99500 }],
          drawdownSeries: [{ tradeId: 'trade-1', equity: 99500, drawdownPct: 0.5 }],
        }),
      },
    )

    expect(result.protectionStatus).toBe('locked')
    expect(result.recommendedAction).toBe('pause trading')
    expect(result.currentDrawdown).toBe(12)
    expect(result.warnings[0]).toContain('Current drawdown')
  })

  it('locks trading when daily or weekly realized paper losses breach limits', () => {
    const result = evaluateDrawdownProtection(
      { account: { equity: 97000 } },
      [
        journalRecord({ tradeId: 'day-loss', realizedPnl: -3500, timestamp: '2026-07-03T13:00:00.000Z' }),
        journalRecord({ tradeId: 'old-loss', realizedPnl: -500, timestamp: '2026-06-20T13:00:00.000Z' }),
      ],
      {
        emitEvent: false,
        timestamp: '2026-07-03T16:00:00.000Z',
        equityPeak: 100000,
        dailyLossThreshold: 3,
        weeklyLossThreshold: 6,
        riskAdjustedPerformance: riskAdjustedSnapshot({
          returnSeries: [
            { tradeId: 'day-loss', realizedPnl: -3500, endingEquity: 96500 },
            { tradeId: 'old-loss', realizedPnl: -500, endingEquity: 96000 },
          ],
          drawdownSeries: [
            { tradeId: 'day-loss', equity: 96500, drawdownPct: 3.5 },
            { tradeId: 'old-loss', equity: 96000, drawdownPct: 4 },
          ],
        }),
      },
    )

    expect(result.protectionStatus).toBe('locked')
    expect(result.dailyLoss.amount).toBe(3500)
    expect(result.dailyLoss.pct).toBe(3.5)
    expect(result.weeklyLoss.amount).toBe(3500)
    expect(result.warnings.some((warning) => warning.includes('Daily loss'))).toBe(true)
  })

  it('tracks equity peak from risk-adjusted performance when no explicit peak is supplied', () => {
    const result = evaluateDrawdownProtection(
      { account: { equity: 101000 } },
      [journalRecord({ tradeId: 'trade-1', realizedPnl: -1000 })],
      {
        emitEvent: false,
        riskAdjustedPerformance: riskAdjustedSnapshot({
          startingEquity: 100000,
          returnSeries: [{ tradeId: 'trade-1', realizedPnl: -1000, endingEquity: 101000 }],
          drawdownSeries: [
            { tradeId: 'trade-1', equity: 105000, drawdownPct: 0 },
            { tradeId: 'trade-2', equity: 101000, drawdownPct: 3.8095 },
          ],
        }),
      },
    )

    expect(result.equityPeak).toBe(105000)
    expect(result.currentDrawdown).toBeCloseTo(3.8095, 4)
  })

  it('emits the drawdown protection event', () => {
    const eventBus = createEventBus()
    const events = []

    eventBus.subscribe(PORTFOLIO_DRAWDOWN_PROTECTION_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createDrawdownProtectionEngine({ eventBus }).evaluate(
      { account: { equity: 100000 } },
      [journalRecord({ tradeId: 'trade-1', realizedPnl: 100 })],
      {
        timestamp: '2026-07-03T16:00:00.000Z',
        riskAdjustedPerformance: riskAdjustedSnapshot(),
      },
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(PORTFOLIO_DRAWDOWN_PROTECTION_EVALUATED_EVENT)
  })
})
