import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  createMarketDataAdapter,
  createMarketDataAdapterInterface,
  createMockMarketDataAdapter,
  MARKET_DATA_ADAPTER_CHECKED_EVENT,
} from './marketDataAdapter.js'
import {
  isMarketDataStale,
  normalizeCandle,
  normalizeQuote,
  normalizeSymbolMetadata,
} from './marketNormalizer.js'

describe('market data adapter foundation', () => {
  it('validates the market data adapter interface', () => {
    expect(() => createMarketDataAdapterInterface({ getQuote() {} })).toThrow('market data adapter missing methods')

    const adapter = createMockMarketDataAdapter()
    expect(createMarketDataAdapterInterface(adapter)).toBe(adapter)
  })

  it('uses the mock adapter as the default paper market data adapter', async () => {
    const adapter = createMarketDataAdapter()
    const quote = await adapter.getQuote('SPY', { assetType: 'etf' })

    expect(adapter.metadata.default).toBe(true)
    expect(adapter.metadata.paperTrading).toBe(true)
    expect(quote.ok).toBe(true)
    expect(quote.provider).toBe('mock-market-data-adapter')
    expect(quote.data).toMatchObject({
      symbol: 'SPY',
      assetType: 'etf',
      provider: 'mock-market-data-adapter',
    })
  })

  it('normalizes quote data consistently', () => {
    const quote = normalizeQuote({
      symbol: 'spy',
      assetType: 'etf',
      price: '525.25',
      previous_close: '520',
      percent_change: '1.01',
      timestamp: '2026-07-03T15:00:00.000Z',
    }, 'test-provider')

    expect(quote).toMatchObject({
      symbol: 'SPY',
      price: 525.25,
      previousClose: 520,
      changePercent: 1.01,
      provider: 'test-provider',
      updatedAt: '2026-07-03T15:00:00.000Z',
    })
  })

  it('normalizes candle data consistently', () => {
    const candle = normalizeCandle({
      symbol: 'BTC-USD',
      assetType: 'crypto',
      open: '62000',
      high: '63000',
      low: '61000',
      close: '62500',
      volume: '1500',
      timestamp: '2026-07-03T00:00:00.000Z',
    }, 'test-provider', { interval: '1d' })

    expect(candle).toMatchObject({
      symbol: 'BTC-USD',
      assetType: 'crypto',
      open: 62000,
      high: 63000,
      low: 61000,
      close: 62500,
      volume: 1500,
      interval: '1d',
      provider: 'test-provider',
    })
  })

  it('normalizes symbol metadata for asset-agnostic consumers', () => {
    const metadata = normalizeSymbolMetadata('EURUSD')

    expect(metadata).toMatchObject({
      symbol: 'EURUSD',
      assetType: 'forex',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
    })
    expect(metadata.quantityTerm).toBe('units')
    expect(metadata.tickSize).toBeGreaterThan(0)
  })

  it('detects stale market data', () => {
    expect(isMarketDataStale('2026-07-03T15:00:00.000Z', {
      now: '2026-07-03T15:02:00.000Z',
      staleAfterMs: 90000,
    })).toBe(true)
    expect(isMarketDataStale('2026-07-03T15:00:45.000Z', {
      now: '2026-07-03T15:02:00.000Z',
      staleAfterMs: 90000,
    })).toBe(false)
  })

  it('returns provider health status and stale state', async () => {
    const adapter = createMockMarketDataAdapter({ staleAfterMs: 90000 })

    await adapter.getQuote('SPY', {
      assetType: 'etf',
      updatedAt: '2026-07-03T15:00:00.000Z',
    })

    const healthy = await adapter.checkHealth({ now: '2026-07-03T15:01:00.000Z' })
    const stale = await adapter.checkHealth({ now: '2026-07-03T15:02:31.000Z' })

    expect(healthy.status).toBe('healthy')
    expect(healthy.stale).toBe(false)
    expect(stale.status).toBe('stale')
    expect(stale.stale).toBe(true)
  })

  it('handles adapter errors safely for unsupported mock symbols', async () => {
    const adapter = createMockMarketDataAdapter()
    const result = await adapter.getQuote('UNKNOWN')

    expect(result.ok).toBe(false)
    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'market_data_adapter_error',
      message: 'symbol is not supported by mock adapter',
    })
  })

  it('returns normalized candles and symbol metadata from the adapter', async () => {
    const adapter = createMockMarketDataAdapter()
    const candles = await adapter.getCandles('SPY', { assetType: 'etf', interval: '1d' })
    const metadata = await adapter.getSymbolMetadata('SPY', { assetType: 'etf' })

    expect(candles.ok).toBe(true)
    expect(candles.data[0]).toMatchObject({
      symbol: 'SPY',
      assetType: 'etf',
      interval: '1d',
      provider: 'mock-market-data-adapter',
    })
    expect(metadata.ok).toBe(true)
    expect(metadata.data).toMatchObject({
      symbol: 'SPY',
      assetType: 'etf',
      quantityTerm: 'shares',
    })
  })

  it('emits market data adapter health check events', async () => {
    const eventBus = createEventBus()
    const events = []
    const adapter = createMockMarketDataAdapter({ eventBus })

    eventBus.subscribe(MARKET_DATA_ADAPTER_CHECKED_EVENT, (payload) => events.push(payload))

    const result = await adapter.checkHealth({ now: '2026-07-03T15:00:00.000Z' })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0]).toMatchObject({
      provider: 'mock-market-data-adapter',
      paperTrading: true,
      status: 'healthy',
    })
  })
})
