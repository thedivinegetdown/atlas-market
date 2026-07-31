import { describe, expect, it, vi } from 'vitest'
import {
  buildDailyIndicatorBundle, calculateAdx, calculateAtr, calculateRelativeStrength,
  calculateRelativeVolume, calculateRsi, calculateSma, createDailyIndicatorPipeline,
  normalizeDailyCandles,
} from '../lib/market/indicators/index.js'
import { createMarketRegimeOrchestrator } from '../lib/market/regime/marketRegimeOrchestrator.js'
import { createWorkspaceDataService } from '../lib/workspace/workspaceDataService.js'

const NOW = '2026-07-30T22:00:00.000Z'

function candles(count = 260, { symbol = 'SPY', start = 100, step = 1, source = 'fixture' } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const close = start + (index * step)
    return {
      symbol,
      timestamp: new Date(Date.parse(NOW) - ((count - 1 - index) * 86400000)).toISOString(),
      open: close - 0.5,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1000 + (index * 10),
      provider: source,
      completed: true,
    }
  })
}

describe('daily candle normalization', () => {
  it('sorts oldest to newest and deterministically keeps the last duplicate', () => {
    const latest = candles(1)[0]
    const prior = { ...latest, timestamp: new Date(Date.parse(latest.timestamp) - 86400000).toISOString(), close: 99, open: 98.5, high: 101, low: 97 }
    const input = [prior, latest, { ...latest, close: 101, high: 103 }]
    const result = normalizeDailyCandles(input, { symbol: 'SPY', now: NOW })
    expect(result.candles.map((candle) => candle.close)).toEqual([99, 101])
    expect(result.duplicateCount).toBe(1)
  })

  it.each([
    [{ open: 10, high: 8, low: 9, close: 10, volume: 1 }, 'invalid OHLC'],
    [{ open: 10, high: 11, low: 9, close: 10, volume: -1 }, 'negative volume'],
    [{ open: 10, high: 11, low: 9, close: 10, volume: 1, timestamp: 'bad' }, 'invalid timestamp'],
  ])('rejects %s (%s)', (overrides) => {
    const result = normalizeDailyCandles([{ ...candles(1)[0], ...overrides }], { symbol: 'SPY', now: NOW })
    expect(result.candles).toEqual([])
    expect(result.invalid).toHaveLength(1)
  })

  it('excludes an explicitly partial candle and a current candle while the market is open', () => {
    const current = { ...candles(1)[0], timestamp: '2026-07-30T20:00:00.000Z', completed: undefined }
    const explicit = { ...candles(1)[0], timestamp: '2026-07-29T20:00:00.000Z', completed: false }
    const result = normalizeDailyCandles([explicit, current], { symbol: 'SPY', now: NOW, marketOpen: true })
    expect(result.candles).toEqual([])
    expect(result.invalid.every((entry) => entry.reason === 'incomplete_current_candle')).toBe(true)
  })
})

describe('deterministic daily calculations', () => {
  it.each([[20], [50], [200]])('calculates canonical SMA %i', (window) => {
    const values = Array.from({ length: window }, (_, index) => index + 1)
    expect(calculateSma(values, window)).toBe((window + 1) / 2)
  })

  it('returns null for insufficient SMA history', () => {
    expect(calculateSma([1, 2, 3], 20)).toBeNull()
  })

  it('calculates Wilder ATR 14 and ATR percentage through the bundle', () => {
    expect(calculateAtr(candles(30), 14).value).toBe(4)
    const bundle = buildDailyIndicatorBundle({ symbol: 'SPY', candles: candles(30), benchmarkCandles: candles(30) }, { calculatedAt: NOW, now: NOW })
    expect(bundle.indicators.atr).toBe(4)
    expect(bundle.indicators.atrPct).toBeCloseTo((4 / 129) * 100, 5)
  })

  it('calculates ATR percentile only with the configured ATR sample', () => {
    const sufficient = buildDailyIndicatorBundle({ symbol: 'SPY', candles: candles(260), benchmarkCandles: candles(260) }, { calculatedAt: NOW, now: NOW })
    const insufficient = buildDailyIndicatorBundle({ symbol: 'SPY', candles: candles(50), benchmarkCandles: candles(50) }, { calculatedAt: NOW, now: NOW })
    expect(sufficient.indicators.atrPercentile).toBe(100)
    expect(insufficient.coverage.missing).toContain('atrPercentile')
  })

  it('calculates Wilder ADX after warm-up and omits it before warm-up', () => {
    expect(calculateAdx(candles(40), 14)).toBe(100)
    expect(calculateAdx(candles(27), 14)).toBeNull()
  })

  it('calculates Wilder RSI 14', () => {
    expect(calculateRsi(candles(20), 14)).toBe(100)
  })

  it('calculates relative volume and safely handles a zero average', () => {
    expect(calculateRelativeVolume(candles(21), 20)).toBeGreaterThan(1)
    const zeroHistory = candles(21).map((candle, index) => ({ ...candle, volume: index === 20 ? 100 : 0 }))
    expect(calculateRelativeVolume(zeroHistory, 20)).toBeNull()
  })

  it('calculates normalized SMA slopes, benchmark condition, and aligned relative strength', () => {
    const bundle = buildDailyIndicatorBundle({
      symbol: 'AAPL',
      candles: candles(260, { symbol: 'AAPL', step: 2 }),
      benchmarkSymbol: 'SPY',
      benchmarkCandles: candles(260, { symbol: 'SPY', step: 1 }),
    }, { calculatedAt: NOW, now: NOW })
    expect(bundle.indicators.movingAverageSlopePct).toBeGreaterThan(0)
    expect(bundle.indicators.mediumMovingAverageSlopePct).toBeGreaterThan(0)
    expect(bundle.indicators.benchmarkAboveLongAverage).toBe(true)
    expect(bundle.indicators.benchmarkChangePct).toBeGreaterThan(0)
    expect(bundle.indicators.relativeStrengthPct).toBeGreaterThan(0)
  })

  it('aligns relative strength by trading date and reports insufficient overlap', () => {
    const symbol = candles(30, { symbol: 'AAPL', step: 2 })
    const benchmark = candles(30).map((candle) => ({ ...candle, timestamp: new Date(Date.parse(candle.timestamp) + 86400000 * 1000).toISOString() }))
    expect(calculateRelativeStrength(symbol, benchmark, 20)).toBeNull()
  })
})

describe('daily indicator bundle and MI.2 integration', () => {
  it('preserves provider provenance and produces stable output for fixed inputs', () => {
    const input = { symbol: 'SPY', source: 'fallback-provider', candles: candles(260), benchmarkCandles: candles(260) }
    const first = buildDailyIndicatorBundle(input, { calculatedAt: NOW, now: NOW })
    const second = buildDailyIndicatorBundle(input, { calculatedAt: NOW, now: NOW })
    expect(first).toEqual(second)
    expect(first.provenance.adx).toMatchObject({
      source: 'fixture', symbol: 'SPY', timeframe: '1D', calculation: 'wilder-adx',
      sourceCandleCount: 260,
    })
    expect(first.pipelineVersion).toBe('daily-indicators-v1')
  })

  it('isolates missing indicators when history is insufficient or malformed', () => {
    const malformed = [...candles(20), { ...candles(1)[0], timestamp: 'bad' }]
    const bundle = buildDailyIndicatorBundle({ symbol: 'AAPL', candles: malformed, benchmarkCandles: [] }, { calculatedAt: NOW, now: NOW })
    expect(bundle.indicators.shortMovingAverage).toBeDefined()
    expect(bundle.coverage.missing).toContain('longMovingAverage')
    expect(bundle.coverage.invalid).toHaveLength(1)
    expect(bundle.warnings).toContain('Benchmark SPY history is unavailable')
  })

  it('fetches the SPY benchmark only once when symbol and benchmark are identical', async () => {
    const getCandles = vi.fn().mockResolvedValue({ ok: true, provider: 'fixture', data: candles(260) })
    const bundle = await createDailyIndicatorPipeline({ marketDataService: { getCandles } }).build({ symbol: 'SPY', timeframe: '1D' }, { calculatedAt: NOW, now: NOW })
    expect(getCandles).toHaveBeenCalledTimes(1)
    expect(bundle.indicators.longMovingAverage).toBeDefined()
  })

  it('accepts approved daily timeframe aliases and rejects intraday input', async () => {
    const getCandles = vi.fn().mockResolvedValue({ ok: true, provider: 'fixture', data: candles(30) })
    const pipeline = createDailyIndicatorPipeline({ marketDataService: { getCandles } })
    await expect(pipeline.build({ symbol: 'SPY', timeframe: 'DAILY' }, { calculatedAt: NOW, now: NOW })).resolves.toMatchObject({ timeframe: '1D' })
    await expect(pipeline.build({ symbol: 'SPY', timeframe: '1H' }, { calculatedAt: NOW, now: NOW })).rejects.toThrow('supports only 1D')
  })

  it('remains compatible with provider fallback responses and benchmark failure', async () => {
    const getCandles = vi.fn()
      .mockResolvedValueOnce({ ok: true, provider: 'mock-fallback', data: candles(30, { symbol: 'AAPL' }) })
      .mockResolvedValueOnce({ ok: false, provider: 'atlas-default', error: { code: 'unavailable' } })
    const bundle = await createDailyIndicatorPipeline({ marketDataService: { getCandles } }).build({ symbol: 'AAPL', timeframe: '1D' }, { calculatedAt: NOW, now: NOW })
    expect(bundle.provenance.price.source).toBe('fixture')
    expect(bundle.coverage.missing).toContain('relativeStrengthPct')
    expect(bundle.warnings).toContain('Benchmark SPY provider is unavailable')
  })

  it('passes normalized observations to MI.2 and improves the regime result', () => {
    const bundle = buildDailyIndicatorBundle({ symbol: 'SPY', candles: candles(260), benchmarkCandles: candles(260) }, { calculatedAt: NOW, now: NOW })
    const result = createMarketRegimeOrchestrator().classify({ symbol: 'SPY', timeframe: '1D', indicatorBundle: bundle }, { now: NOW })
    expect(result.classification.status).toBe('COMPLETE')
    expect(result.classification.trendRegime).not.toBe('UNKNOWN')
    expect(result.inputCoverage.available).toContain('longMovingAverage')
    expect(result.paperTrading).toBe(true)
    expect(result.advisoryOnly).toBe(true)
  })

  it('keeps one-candle production fallback honest', () => {
    const bundle = buildDailyIndicatorBundle({ symbol: 'SPY', candles: candles(1), benchmarkCandles: candles(1) }, { calculatedAt: NOW, now: NOW })
    const result = createMarketRegimeOrchestrator().classify({ symbol: 'SPY', timeframe: '1D', indicatorBundle: bundle }, { now: NOW })
    expect(result.classification.status).toBe('INSUFFICIENT_DATA')
    expect(bundle.coverage.missing).toContain('shortMovingAverage')
  })

  it('composes the bundle in the existing workspace service without order or strategy effects', async () => {
    const quote = { symbol: 'SPY', price: 359, provider: 'fixture', updatedAt: NOW }
    const indicatorBundle = buildDailyIndicatorBundle({ symbol: 'SPY', candles: candles(260), benchmarkCandles: candles(260) }, { calculatedAt: NOW, now: NOW })
    const marketDataService = {
      getQuote: vi.fn().mockResolvedValue(quote),
      getCandles: vi.fn(),
      getWatchlistQuotes: vi.fn(),
    }
    const indicatorPipeline = { build: vi.fn().mockResolvedValue(indicatorBundle) }
    const service = createWorkspaceDataService({ marketDataService, indicatorPipeline })
    const result = await service.getMarketOverview('SPY', { now: NOW, includeHistoricalIntelligence: true })
    expect(indicatorPipeline.build).toHaveBeenCalledOnce()
    expect(result.regime.classification.status).toBe('COMPLETE')
    expect(result.indicatorBundle).toBeUndefined()
    expect(result.paperTrading).toBe(true)
  })

  it('does not request provider-backed history for the unauthenticated/demo service path', async () => {
    const quote = { symbol: 'SPY', price: 359, provider: 'fixture', updatedAt: NOW }
    const marketDataService = {
      getQuote: vi.fn().mockResolvedValue(quote),
      getCandles: vi.fn(),
      getWatchlistQuotes: vi.fn(),
    }
    const indicatorPipeline = { build: vi.fn() }
    const result = await createWorkspaceDataService({ marketDataService, indicatorPipeline }).getMarketOverview('SPY', { now: NOW })
    expect(indicatorPipeline.build).not.toHaveBeenCalled()
    expect(marketDataService.getCandles).not.toHaveBeenCalled()
    expect(result.regime.classification.status).toBe('INSUFFICIENT_DATA')
  })
})
