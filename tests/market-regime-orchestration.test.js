import { describe, expect, it, vi } from 'vitest'
import { buildRegimeInput } from '../lib/market/regime/buildRegimeInput.js'
import { createMarketRegimeOrchestrator } from '../lib/market/regime/marketRegimeOrchestrator.js'

const NOW = '2026-07-30T15:00:00.000Z'
const DAILY = '2026-07-30T14:00:00.000Z'

function observation(value, overrides = {}) {
  return { value, source: 'atlas-indicators', symbol: 'SPY', timeframe: 'daily', observedAt: DAILY, receivedAt: NOW, derivation: 'calculated', ...overrides }
}

function completeObservations() {
  return {
    price: observation('520', { source: 'twelve-data', timeframe: 'quote', observedAt: NOW, derivation: 'provider-supplied' }),
    sma20: observation(515), sma50: observation(505), sma200: observation(480),
    maSlopePct: observation(0.8), adx: observation(28), atrRatio: observation(0.018),
    atrPercentile: observation(55), rsi: observation(62), volumeRatio: observation(1.2),
    breadthRatio: observation(0.68), vix: observation(17), benchmarkTrendPct: observation(1.1),
    benchmarkAboveLongAverage: observation(true), relativeStrength: observation(2.4),
  }
}

describe('market regime input orchestration', () => {
  it('normalizes aliases, units, numeric strings, timeframes, and provenance', () => {
    const result = buildRegimeInput({ symbol: 'SPY', timeframe: '1D', observations: completeObservations() }, { now: NOW })
    expect(result.metrics).toMatchObject({ price: 520, shortMovingAverage: 515, atrPct: 1.8, marketBreadthPct: 68, volatilityIndex: 17 })
    expect(result.provenance.price).toMatchObject({ source: 'twelve-data', symbol: 'SPY', timeframe: 'REALTIME', freshness: 'FRESH', derivation: 'provider-supplied' })
    expect(result.inputCoverage.invalid).toEqual([])
  })

  it('returns a complete, fresh, stable read model and invokes the engine with normalized input', () => {
    const classifier = vi.fn(() => ({ trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', confidence: 82, status: 'COMPLETE', reasons: ['Evidence'], engineVersion: 'market-regime-v1' }))
    const orchestrator = createMarketRegimeOrchestrator({ classifier })
    const context = { symbol: 'SPY', timeframe: 'daily', observations: completeObservations() }
    const first = orchestrator.classify(context, { now: NOW })
    const second = orchestrator.classify(context, { now: NOW })
    expect(classifier).toHaveBeenCalledWith(expect.objectContaining({ shortMovingAverage: 515, atrPct: 1.8 }), undefined)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ symbol: 'SPY', timeframe: '1D', freshness: 'FRESH', asOf: NOW, engineVersion: 'market-regime-v1', paperTrading: true, advisoryOnly: true })
  })

  it('omits stale and unknown-timestamp fields instead of classifying them as fresh', () => {
    const observations = {
      price: observation(520, { observedAt: '2026-07-20T00:00:00.000Z', timeframe: 'quote' }),
      sma20: observation(515, { observedAt: null }),
    }
    const result = createMarketRegimeOrchestrator().classify({ symbol: 'SPY', timeframe: '1D', observations }, { now: NOW })
    expect(result.freshness).toBe('STALE')
    expect(result.inputCoverage.stale).toEqual(['price'])
    expect(result.inputCoverage.unknownFreshness).toEqual(['shortMovingAverage'])
    expect(result.classification.status).toBe('INSUFFICIENT_DATA')
  })

  it('rejects mixed intraday indicators while allowing realtime price for a daily target', () => {
    const built = buildRegimeInput({ symbol: 'SPY', timeframe: '1D', observations: {
      price: observation(520, { timeframe: 'realtime', observedAt: NOW }),
      sma20: observation(515, { timeframe: '1H' }),
    } }, { now: NOW })
    expect(built.inputCoverage.available).toEqual(['price'])
    expect(built.inputCoverage.incompatible).toEqual(['shortMovingAverage'])
    expect(built.warnings[0]).toContain('incompatible')
  })

  it('omits malformed fields and records missing indicators without deriving replacements', () => {
    const built = buildRegimeInput({ symbol: 'SPY', observations: {
      price: observation('not-a-number', { timeframe: 'quote' }),
      adx: observation(25),
    } }, { now: NOW })
    expect(built.inputCoverage.invalid).toEqual(['price'])
    expect(built.inputCoverage.missing).toContain('shortMovingAverage')
    expect(built.metrics).toEqual({ adx: 25 })
  })

  it('has no order, portfolio, strategy, provider, or indicator-calculation side effects', () => {
    const context = Object.freeze({ symbol: 'SPY', timeframe: '1D', observations: Object.freeze(completeObservations()) })
    createMarketRegimeOrchestrator().classify(context, { now: NOW })
    expect(context.observations.sma20.value).toBe(515)
  })
})
