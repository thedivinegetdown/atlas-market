import { describe, expect, it } from 'vitest'
import { buildVolatilityExpansionSignal } from '../lib/strategies/volatility/volatilityExpansionSignal.js'

const candles = Array.from({ length: 120 }, (_, index) => { const range = index < 116 ? 5 : 1; const close = 100 + index * 0.1; return { timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), open: close, high: close + range, low: close - range, close, volume: 1000, completed: true } })
const indicators = { shortMovingAverage: 115, mediumMovingAverage: 110, longMovingAverage: 100, atr: 2, atrPct: 2, atrPercentile: 30, adx: 20, rsi: 55, relativeVolume: 1.2, relativeStrengthPct: 1 }
const signal = (overrides = {}) => buildVolatilityExpansionSignal({ symbol: 'SPY', currentPrice: 120, candles, indicatorBundle: { indicators, coverage: { available: Object.keys(indicators), missing: [] } }, regime: { classification: { trendRegime: 'BULL', riskRegime: 'RISK_ON' } }, marketContext: { participation: { status: 'BROAD_STRENGTH' } }, ...overrides })
describe('volatility expansion signal', () => {
  it('requires a completed compression sequence followed by a strict expansion', () => { expect(signal()).toMatchObject({ compressionConfirmed: true, compressionCount: 4, suitabilityStatus: 'ENABLED' }); expect(signal({ currentPrice: 116.5 }).suitabilityStatus).toBe('REJECTED') })
  it.each([[1.19, 'REJECTED'], [19.9, 'REJECTED'], [54.9, 'REJECTED'], [75.1, 'REJECTED']])('enforces volume, ADX, and RSI boundaries', (value, expected) => { const updated = value < 2 ? { relativeVolume: value } : value < 30 ? { adx: value } : { rsi: value }; expect(signal({ indicatorBundle: { indicators: { ...indicators, ...updated } } }).suitabilityStatus).toBe(expected) })
  it('fails closed for insufficient history or stale evidence', () => { expect(signal({ candles: candles.slice(20) }).suitabilityStatus).toBe('INSUFFICIENT_DATA'); expect(signal({ evidenceFreshness: 'STALE' }).suitabilityStatus).toBe('STALE') })
})