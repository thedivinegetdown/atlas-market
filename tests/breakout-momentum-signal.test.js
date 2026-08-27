import { describe, expect, it } from 'vitest'
import { buildBreakoutMomentumSignal } from '../lib/strategies/breakout/breakoutMomentumSignal.js'

const indicators = { shortMovingAverage: 120, mediumMovingAverage: 110, longMovingAverage: 100, adx: 20, rsi: 55, relativeVolume: 1.2, relativeStrengthPct: 0.1 }
const candles = Array.from({ length: 20 }, (_, index) => ({ timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, open: 90, high: 100 + index, low: 80, close: 95, volume: 1000, completed: true }))
function signal(overrides = {}) {
  return buildBreakoutMomentumSignal({ symbol: 'SPY', currentPrice: 120, candles, indicatorBundle: { indicators, coverage: { available: Object.keys(indicators), missing: [] } }, ...overrides })
}

describe('breakout momentum signal', () => {
  it('uses exactly 20 completed daily bars and requires a strict breakout', () => {
    expect(signal()).toMatchObject({ prior20High: 119, suitabilityStatus: 'ENABLED' })
    expect(signal({ currentPrice: 119 }).suitabilityStatus).toBe('REJECTED')
    expect(signal({ currentPrice: 118 }).suitabilityStatus).toBe('REJECTED')
    expect(signal({ candles: candles.slice(1) }).suitabilityStatus).toBe('INSUFFICIENT_DATA')
  })

  it.each([
    ['SMA ordering', { shortMovingAverage: 110, mediumMovingAverage: 120 }],
    ['low ADX', { adx: 19.9 }],
    ['low RSI', { rsi: 54.9 }],
    ['high RSI', { rsi: 75.1 }],
    ['low relative volume', { relativeVolume: 1.19 }],
    ['missing relative strength', { relativeStrengthPct: null }],
  ])('rejects invalid %s evidence', (_, overrides) => {
    expect(signal({ indicatorBundle: { indicators: { ...indicators, ...overrides } } }).suitabilityStatus).not.toBe('ENABLED')
  })

  it('preserves boundary values and fails closed for stale evidence', () => {
    expect(signal({ indicatorBundle: { indicators: { ...indicators, rsi: 75 } } }).suitabilityStatus).toBe('ENABLED')
    expect(signal({ evidenceFreshness: 'STALE' })).toMatchObject({ suitabilityStatus: 'STALE' })
  })
})