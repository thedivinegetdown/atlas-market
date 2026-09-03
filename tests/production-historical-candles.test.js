import { describe, expect, it, vi } from 'vitest'
import { createDefaultMarketDataProvider } from '../lib/market/defaultMarketDataProvider.js'
import { normalizeHistoricalDailyCandles } from '../lib/market/historicalCandleNormalizer.js'
import { createDailyIndicatorPipeline } from '../lib/market/indicators/dailyIndicatorPipeline.js'
import { createTwelveDataClient } from '../lib/market/twelveDataClient.js'

function values(count = 260) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index
    return {
      datetime: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: String(close - 1),
      high: String(close + 2),
      low: String(close - 2),
      close: String(close),
      volume: String(1000000 + index),
    }
  })
}

function response(payload, { status = 200, ok = status >= 200 && status < 300, headers = {} } = {}) {
  return { ok, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, async json() { return payload } }
}

function provider(fetchImpl, options = {}) {
  return createDefaultMarketDataProvider({
    twelveDataApiKey: 'configured-existing-key',
    finnhubApiKey: 'configured-existing-key',
    fetchImpl,
    logger: { info: vi.fn(), warn: vi.fn() },
    ...options,
  })
}

describe('production historical candle integration', () => {
  it('retrieves and canonically normalizes 260 daily OHLCV candles through Twelve Data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ status: 'ok', meta: { symbol: 'SPY' }, values: values() }))
    const result = await provider(fetchImpl).getCandles('SPY', { interval: '1d', limit: 260 })
    expect(result).toMatchObject({
      ok: true, provider: 'twelvedata', candleCount: 260, historyCompleteness: 'COMPLETE',
      fallbackUsed: false, cache: { state: 'MISS' },
    })
    expect(result.data[0]).toMatchObject({
      symbol: 'SPY', interval: '1d', timeframe: '1D', provider: 'twelvedata',
      open: 99, high: 102, low: 98, close: 100, volume: 1000000,
    })
    const requestedUrl = new URL(fetchImpl.mock.calls[0][0])
    expect(requestedUrl.pathname).toBe('/time_series')
    expect(requestedUrl.searchParams.get('interval')).toBe('1day')
    expect(requestedUrl.searchParams.get('outputsize')).toBe('260')
    expect(requestedUrl.searchParams.get('order')).toBe('asc')
  })

  it('does not silently substitute Finnhub premium candles or a synthetic quote', async () => {
    const result = await createDefaultMarketDataProvider({
      twelveDataApiKey: '',
      finnhubApiKey: 'free-key',
      logger: { info: vi.fn(), warn: vi.fn() },
    }).getCandles('SPY', { interval: '1d' })
    expect(result.ok).toBe(false)
    expect(result.data).toBeUndefined()
    expect(result.warnings).toContain('No approved free fallback provider returned genuine historical daily candles')
    expect(result.fallbackAttempts).toEqual([
      { provider: 'twelvedata', status: 'missing_api_key' },
      { provider: 'finnhub', status: 'skipped_premium_history' },
      { provider: 'mock', status: 'skipped_synthetic_history' },
    ])
  })

  it('reports malformed provider responses', async () => {
    const client = createTwelveDataClient({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ status: 'ok', values: null })),
    })
    await expect(client.getCandles('SPY')).resolves.toMatchObject({
      ok: false,
      error: { code: 'malformed_provider_response' },
    })
  })

  it('resolves duplicate timestamps, excludes invalid candles, and reports both', async () => {
    const raw = values()
    raw.push({ ...raw.at(-1), close: '400', high: '402' })
    raw.push({ ...raw[0], datetime: '2024-01-01', high: '90', low: '110' })
    const result = await provider(vi.fn().mockResolvedValue(response({ status: 'ok', values: raw }))).getCandles('SPY', { interval: '1d' })
    expect(result.candleCount).toBe(260)
    expect(result.duplicateCount).toBe(1)
    expect(result.invalidCandles).toHaveLength(1)
    expect(result.data.at(-1).close).toBe(400)
    expect(result.warnings.join(' ')).toContain('duplicate')
  })

  it('returns truncated history with structured completeness warnings', async () => {
    const result = await provider(vi.fn().mockResolvedValue(response({ status: 'ok', values: values(100) }))).getCandles('SPY', { interval: 'daily', limit: 260 })
    expect(result).toMatchObject({ ok: true, candleCount: 100, historyCompleteness: 'TRUNCATED' })
    expect(result.warnings[0]).toContain('100 of 260')
  })

  it.each([
    [response({}, { status: 429, ok: false })],
    [response({ status: 'error', code: 429, message: 'credits exceeded' })],
  ])('normalizes HTTP and payload rate limits', async (providerResponse) => {
    const client = createTwelveDataClient({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(providerResponse) })
    await expect(client.getCandles('SPY')).resolves.toMatchObject({
      ok: false, status: 429, error: { code: 'provider_rate_limited' },
    })
  })

  it('rejects unsupported intervals without calling the provider', async () => {
    const fetchImpl = vi.fn()
    const result = await createTwelveDataClient({ apiKey: 'key', fetchImpl }).getCandles('SPY', { interval: '1h' })
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported_interval' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the existing in-memory provider cache without changing candle timestamps', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ status: 'ok', values: values() }))
    const marketProvider = provider(fetchImpl)
    const first = await marketProvider.getCandles('SPY', { interval: '1d' })
    const second = await marketProvider.getCandles('SPY', { interval: '1d' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(first.cache.state).toBe('MISS')
    expect(second.cache.state).toBe('HIT')
    expect(second.data).toEqual(first.data)
  })

  it('deduplicates identical in-flight requests', async () => {
    let resolveRequest
    const fetchImpl = vi.fn().mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    const marketProvider = provider(fetchImpl)
    const first = marketProvider.getCandles('SPY', { interval: '1d' })
    const second = marketProvider.getCandles('SPY', { interval: '1d' })
    resolveRequest(response({ status: 'ok', values: values() }))
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(secondResult).toEqual(firstResult)
  })

  it.each([
    [{ interval: '1d', limit: 261 }, 'unsupported_history_size'],
    [{ interval: '1d', range: '5y' }, 'unsupported_history_range'],
  ])('rejects unsupported request scope without provider traffic', async (options, code) => {
    const fetchImpl = vi.fn()
    const result = await provider(fetchImpl).getCandles('SPY', options)
    expect(result).toMatchObject({ ok: false, error: { code } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns structured process-local budget responses', async () => {
    const historicalBudget = { consume: vi.fn().mockReturnValue({ ok: false, code: 'historical_daily_budget_exceeded', retryAfterSeconds: 120, budget: { scope: 'process-local' } }), inspect: vi.fn() }
    const result = await provider(vi.fn(), { historicalBudget }).getCandles('SPY', { interval: '1d' })
    expect(result).toMatchObject({
      ok: false,
      statusCode: 429,
      retryAfterSeconds: 120,
      error: { code: 'historical_daily_budget_exceeded' },
      budget: { scope: 'process-local' },
    })
  })

  it('preserves provider retry-after and blocks immediate retry without another request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ...response({}, { status: 429, ok: false }),
      headers: { get: (name) => name === 'retry-after' ? '30' : null },
    })
    const marketProvider = provider(fetchImpl)
    const first = await marketProvider.getCandles('SPY', { interval: '1d' })
    const second = await marketProvider.getCandles('SPY', { interval: '1d' })
    expect(first).toMatchObject({ statusCode: 429, retryAfterSeconds: 30, error: { code: 'provider_rate_limited' } })
    expect(second).toMatchObject({ statusCode: 429, retryAfterSeconds: expect.any(Number), error: { code: 'provider_backoff_active' } })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('logs one sanitized historical failure while preserving fail-closed behavior', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const fetchImpl = vi.fn().mockResolvedValue(response({ status: 'error', code: 429, message: 'minute quota reached: configured-existing-key', meta: { quota_scope: 'minute' } }, { headers: { 'retry-after': '15' } }))
    const result = await provider(fetchImpl, { logger }).getCandles('SPY', { interval: '1d', limit: 260 })
    const failures = logger.warn.mock.calls.filter(([event]) => event === 'twelve data provider request failed')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: false, error: { code: 'provider_rate_limited' }, fallbackUsed: false, statusCode: 429 })
    expect(failures).toHaveLength(1)
    expect(failures[0][1]).toMatchObject({ operation: 'historical', provider: 'twelvedata', httpStatus: 200, providerErrorCode: 429, normalizedErrorCode: 'provider_rate_limited', quotaScope: 'minute', retryAfterSeconds: 15, sanitizedMessageCategory: 'RATE_LIMIT' })
    expect(JSON.stringify(failures[0][1])).not.toMatch(/configured-existing-key|minute quota reached|apikey|authorization/i)
  })

  it('normalizes raw records independently of provider payload shape', () => {
    const result = normalizeHistoricalDailyCandles(values(), { symbol: 'SPY', provider: 'fixture', minimumCount: 260 })
    expect(result.historyCompleteness).toBe('COMPLETE')
    expect(result.candles[0].timestamp).toBe('2025-01-01T00:00:00.000Z')
    expect(result.candles.every((candle) => candle.source === 'fixture')).toBe(true)
  })

  it('supplies genuine history to MI.3 without trading side effects', async () => {
    const historical = await provider(vi.fn().mockResolvedValue(response({ status: 'ok', values: values() }))).getCandles('SPY', { interval: '1d' })
    const marketDataService = {
      getCandles: vi.fn().mockResolvedValue(historical),
      getMarketStatus: vi.fn().mockResolvedValue({ ok: true, data: { isOpen: false } }),
    }
    const bundle = await createDailyIndicatorPipeline({ marketDataService }).build(
      { symbol: 'SPY', timeframe: '1D' },
      { now: '2026-07-30T22:00:00.000Z', calculatedAt: '2026-07-30T22:00:00.000Z' },
    )
    expect(bundle.indicators).toMatchObject({
      shortMovingAverage: expect.any(Number),
      mediumMovingAverage: expect.any(Number),
      longMovingAverage: expect.any(Number),
      adx: expect.any(Number),
      atrPct: expect.any(Number),
      rsi: expect.any(Number),
    })
    expect(bundle.paperTrading).toBe(true)
    expect(bundle.advisoryOnly).toBe(true)
  })
})
