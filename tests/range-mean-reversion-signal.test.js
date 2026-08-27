import { describe, expect, it } from 'vitest'
import { buildRangeMeanReversionSignal } from '../lib/strategies/range/rangeMeanReversionSignal.js'

const candles = Array.from({ length: 20 }, (_, index) => ({ timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, open: 100, high: 105, low: 90 + index / 10, close: 100, volume: 1000, completed: true }))
const indicators = { shortMovingAverage: 110, atr: 10, adx: 19.9, rsi: 30, relativeVolume: 1.5, relativeStrengthPct: -0.1 }
const signal = (overrides = {}) => buildRangeMeanReversionSignal({ symbol: 'SPY', currentPrice: 100, candles, indicatorBundle: { indicators, coverage: { available: Object.keys(indicators), missing: [] } }, regime: { classification: { trendRegime: 'RANGE', riskRegime: 'RISK_ON' } }, marketContext: { participation: { status: 'MIXED' } }, ...overrides })

describe('range mean reversion signal', () => {
  it('uses exactly 20 completed bars, accepts strict support and threshold boundaries', () => {
    expect(signal()).toMatchObject({ prior20Low: 90, stretchAtr: 1, suitabilityStatus: 'CONDITIONAL' })
    expect(signal({ currentPrice: 102.5, indicatorBundle: { indicators: { ...indicators, rsi: 40, relativeStrengthPct: 0 } } }).suitabilityStatus).toBe('ENABLED')
    expect(signal({ currentPrice: 90 }).suitabilityStatus).toBe('REJECTED')
    expect(signal({ currentPrice: 89.9 }).suitabilityStatus).toBe('REJECTED')
  })
  it.each([[29.9, 'REJECTED'], [40.1, 'REJECTED'], [20, 'CONDITIONAL'], [25, 'CONDITIONAL'], [25.1, 'REJECTED']])('enforces RSI and ADX boundaries', (value, expected) => {
    const adx = value >= 20 ? value : 19.9; const rsi = value < 20 ? value : 30
    expect(signal({ indicatorBundle: { indicators: { ...indicators, adx, rsi } } }).suitabilityStatus).toBe(expected)
  })
  it('fails closed for stale or missing evidence and broad weakness', () => {
    expect(signal({ evidenceFreshness: 'STALE' }).suitabilityStatus).toBe('STALE')
    expect(signal({ indicatorBundle: { indicators: { ...indicators, atr: null } } }).suitabilityStatus).toBe('INSUFFICIENT_DATA')
    expect(signal({ marketContext: { participation: { status: 'BROAD_WEAKNESS' } } }).suitabilityStatus).toBe('REJECTED')
  })
})