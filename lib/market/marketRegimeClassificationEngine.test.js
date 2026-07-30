import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import { classifyMarketRegime, createMarketRegimeClassificationEngine, MARKET_REGIME_CLASSIFIED_EVENT } from './marketRegimeClassificationEngine.js'

const strongBull = Object.freeze({
  price: 110, shortMovingAverage: 108, mediumMovingAverage: 105, longMovingAverage: 100,
  movingAverageSlopePct: 1.2, adx: 35, atrPct: 1.2, atrPercentile: 50, rsi: 62,
  relativeVolume: 1.3, marketBreadthPct: 72, volatilityIndex: 14,
  benchmarkAboveLongAverage: true, benchmarkChangePct: 1, relativeStrengthPct: 2,
})

const classify = (input, options = {}) => classifyMarketRegime(input, { emitEvent: false, ...options })

describe('deterministic market regime engine v1', () => {
  it('classifies a strong bull trend', () => expect(classify(strongBull).trendRegime).toBe('STRONG_BULL'))

  it('classifies a bull trend', () => {
    const result = classify({ ...strongBull, price: 103, shortMovingAverage: 102, mediumMovingAverage: 100, movingAverageSlopePct: 0.6, adx: 22, relativeStrengthPct: 0 })
    expect(result.trendRegime).toBe('BULL')
  })

  it('classifies a sideways range', () => {
    const result = classify({ price: 100, shortMovingAverage: 100, mediumMovingAverage: 100, longMovingAverage: 100, movingAverageSlopePct: 0, adx: 12, atrPercentile: 50 })
    expect(result.trendRegime).toBe('RANGE')
  })

  it('classifies a bear trend', () => {
    const result = classify({ ...strongBull, price: 97, shortMovingAverage: 98, mediumMovingAverage: 100, movingAverageSlopePct: -0.6, adx: 22, relativeStrengthPct: 0 })
    expect(result.trendRegime).toBe('BEAR')
  })

  it('classifies a strong bear trend', () => {
    const result = classify({ ...strongBull, price: 90, shortMovingAverage: 92, mediumMovingAverage: 95, movingAverageSlopePct: -1.2, adx: 35, relativeStrengthPct: -2 })
    expect(result.trendRegime).toBe('STRONG_BEAR')
  })

  it('classifies high volatility', () => expect(classify({ atrPercentile: 80, atrPct: 3, volatilityIndex: 28 }).volatilityRegime).toBe('HIGH_VOLATILITY'))
  it('classifies normal volatility', () => expect(classify({ atrPercentile: 50, atrPct: 1.4, volatilityIndex: 20 }).volatilityRegime).toBe('NORMAL_VOLATILITY'))
  it('classifies low volatility', () => expect(classify({ atrPercentile: 20, atrPct: 0.5, volatilityIndex: 12 }).volatilityRegime).toBe('LOW_VOLATILITY'))
  it('classifies risk-on conditions', () => expect(classify(strongBull).riskRegime).toBe('RISK_ON'))

  it('classifies neutral risk conditions', () => {
    expect(classify({ marketBreadthPct: 50, volatilityIndex: 20, benchmarkChangePct: 0 }).riskRegime).toBe('NEUTRAL')
  })

  it('classifies risk-off conditions', () => {
    const result = classify({ marketBreadthPct: 25, volatilityIndex: 30, benchmarkAboveLongAverage: false, benchmarkChangePct: -1, relativeStrengthPct: -2 })
    expect(result.riskRegime).toBe('RISK_OFF')
  })

  it('supports mixed trend and volatility combinations', () => {
    const result = classify({ ...strongBull, atrPercentile: 85, atrPct: 3, volatilityIndex: 28 })
    expect(result).toMatchObject({ trendRegime: 'STRONG_BULL', volatilityRegime: 'HIGH_VOLATILITY' })
  })

  it('uses inclusive exact threshold boundaries', () => {
    const volatility = classify({ atrPercentile: 70 })
    const risk = classify({ marketBreadthPct: 60 }, { config: { risk: { riskOnScore: 70 } } })
    const trend = classify({ price: 103, longMovingAverage: 100, shortMovingAverage: 102 }, { config: { trend: { bullScore: 32 } } })
    expect(volatility.volatilityRegime).toBe('HIGH_VOLATILITY')
    expect(risk.riskRegime).toBe('RISK_ON')
    expect(trend.trendRegime).toBe('BULL')
  })

  it('returns partial classifications from a minimum trend input set', () => {
    const result = classify({ price: 105, shortMovingAverage: 103, longMovingAverage: 100 })
    expect(result.status).toBe('PARTIAL')
    expect(result.trendRegime).toBe('BULL')
    expect(result.volatilityRegime).toBe('UNKNOWN')
  })

  it('does not require missing optional data', () => {
    const result = classify({ marketBreadthPct: 72, volatilityIndex: 14 })
    expect(result.riskRegime).toBe('RISK_ON')
    expect(result.missingInputs).toContain('price')
  })

  it('returns insufficient data safely', () => {
    expect(classify({})).toMatchObject({ trendRegime: 'UNKNOWN', volatilityRegime: 'UNKNOWN', riskRegime: 'UNKNOWN', status: 'INSUFFICIENT_DATA', confidence: 0 })
  })

  it('rejects malformed and out-of-range numeric input without throwing', () => {
    const result = classify({ price: 'not-a-number', atrPercentile: 120, marketBreadthPct: 65 })
    expect(result.status).toBe('INVALID_INPUT')
    expect(result.invalidInputs).toEqual(['price', 'atrPercentile'])
    expect(result.confidence).toBeLessThanOrEqual(45)
  })

  it('returns stable output for identical input', () => {
    expect(classify(strongBull)).toEqual(classify(strongBull))
    expect(classify(strongBull)).not.toHaveProperty('evaluatedAt')
  })

  it('penalizes confidence when expected inputs are missing', () => {
    const complete = classify(strongBull)
    const partial = classify({ price: 105, shortMovingAverage: 103, longMovingAverage: 100 })
    expect(partial.confidence).toBeLessThan(complete.confidence)
  })

  it('generates reasons only from available evidence', () => {
    const result = classify({ atrPercentile: 80 })
    expect(result.reasons).toContain('ATR percentile is elevated')
    expect(result.reasons.some((reason) => reason.includes('moving average'))).toBe(false)
  })

  it('is provider-neutral', () => {
    const withProviderNoise = classify({ ...strongBull, provider: 'arbitrary-provider', rawProviderPayload: { ignored: true } })
    expect(withProviderNoise).toEqual(classify(strongBull))
  })

  it('has no trading, order, portfolio, or default event side effects', () => {
    const input = structuredClone(strongBull)
    const before = structuredClone(input)
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(MARKET_REGIME_CLASSIFIED_EVENT, (event) => events.push(event))
    const result = classifyMarketRegime(input, { eventBus })
    expect(input).toEqual(before)
    expect(events).toHaveLength(0)
    expect(result).toMatchObject({ paperTrading: true, advisoryOnly: true })
    expect(result).not.toHaveProperty('order')
    expect(result).not.toHaveProperty('execution')
  })

  it('emits one compact diagnostic event only when explicitly requested', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(MARKET_REGIME_CLASSIFIED_EVENT, (event) => events.push(event))
    const result = createMarketRegimeClassificationEngine({ eventBus, emitEvent: true }).classify(strongBull)
    expect(events).toEqual([result])
    expect(result.engineVersion).toBe('market-regime-v1')
    expect(result.status).toBe('COMPLETE')
  })
})
