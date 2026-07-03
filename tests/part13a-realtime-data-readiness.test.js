import { describe, expect, it, vi } from 'vitest'
import { ASSET_TYPES } from '../lib/assets/index.js'
import { createMarketDataService } from '../lib/market/marketDataService.js'
import {
  createProviderMetadata,
  MARKET_DATA_CAPABILITIES,
  normalizeQuoteResponse,
} from '../lib/market/providerContract.js'
import { createMarketDataProviderRegistry } from '../lib/market/providerRegistry.js'
import { createPollingSubscription } from '../lib/market/pollingSubscription.js'

function createProvider(overrides = {}) {
  return {
    metadata: createProviderMetadata({
      id: overrides.id ?? 'test-provider',
      assetTypes: overrides.assetTypes ?? [ASSET_TYPES.EQUITY],
      capabilities: overrides.capabilities ?? [MARKET_DATA_CAPABILITIES.QUOTES],
      priority: overrides.priority ?? 10,
    }),
    async getQuote(symbol, options) {
      return normalizeQuoteResponse({ symbol, price: 100 }, overrides.id ?? 'test-provider', options)
    },
    async getQuotes(symbols, options) {
      return {
        ok: true,
        provider: overrides.id ?? 'test-provider',
        data: symbols.map((symbol) => ({
          symbol,
          price: 100,
          provider: overrides.id ?? 'test-provider',
          assetType: options?.assetType ?? ASSET_TYPES.EQUITY,
        })),
      }
    },
  }
}

describe('Part 13A real-time data readiness layer', () => {
  it('normalizes provider contract quote responses with asset-aware metadata', () => {
    const response = normalizeQuoteResponse({
      symbol: 'AAPL',
      price: 100,
      open: 99,
      high: 101,
      low: 98,
      previousClose: 99.5,
      volume: 1200,
    }, 'provider-a', { assetType: ASSET_TYPES.EQUITY })

    expect(response).toMatchObject({
      ok: true,
      provider: 'provider-a',
      assetType: 'equity',
      data: {
        symbol: 'AAPL',
        price: 100,
        provider: 'provider-a',
      },
      receivedAt: expect.any(String),
    })
  })

  it('selects the default registry provider by asset type and capability', () => {
    const registry = createMarketDataProviderRegistry({ logger: { debug: vi.fn(), warn: vi.fn() } })
    const provider = createProvider()
    registry.register(provider)

    expect(registry.selectProvider({
      assetType: ASSET_TYPES.EQUITY,
      capability: MARKET_DATA_CAPABILITIES.QUOTES,
    })).toBe(provider)
  })

  it('selects asset-specific providers for future data feeds', () => {
    const registry = createMarketDataProviderRegistry({ logger: { debug: vi.fn(), warn: vi.fn() } })
    const equityProvider = createProvider({ id: 'equity-provider', assetTypes: [ASSET_TYPES.EQUITY], priority: 20 })
    const forexProvider = createProvider({ id: 'forex-provider', assetTypes: [ASSET_TYPES.FOREX], priority: 5 })
    registry.register(equityProvider)
    registry.register(forexProvider)

    expect(registry.selectProvider({
      assetType: ASSET_TYPES.FOREX,
      capability: MARKET_DATA_CAPABILITIES.QUOTES,
    })).toBe(forexProvider)
  })

  it('returns null for unsupported provider capabilities', () => {
    const warn = vi.fn()
    const registry = createMarketDataProviderRegistry({ logger: { debug: vi.fn(), warn } })
    registry.register(createProvider({ capabilities: [MARKET_DATA_CAPABILITIES.QUOTES] }))

    const selected = registry.selectProvider({
      assetType: ASSET_TYPES.EQUITY,
      capability: MARKET_DATA_CAPABILITIES.CANDLES,
    })

    expect(selected).toBeNull()
    expect(warn).toHaveBeenCalledWith('market data provider unavailable', expect.any(Object))
  })

  it('starts and stops polling subscriptions without WebSockets', async () => {
    const callbacks = []
    const scheduler = {
      setTimeout: vi.fn((callback) => {
        callbacks.push(callback)
        return callbacks.length
      }),
      clearTimeout: vi.fn(),
    }
    const fetcher = vi.fn(async () => ({ price: 100 }))
    const onData = vi.fn()
    const subscription = createPollingSubscription({
      fetcher,
      onData,
      scheduler,
      intervalMs: 1000,
    })

    subscription.start()
    await Promise.resolve()

    expect(subscription.isRunning()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(scheduler.setTimeout).toHaveBeenCalledTimes(1)

    subscription.stop()

    expect(subscription.isRunning()).toBe(false)
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(1)
  })

  it('supports refreshNow and error callbacks', async () => {
    const error = new Error('provider down')
    const onData = vi.fn()
    const onError = vi.fn()
    const subscription = createPollingSubscription({
      fetcher: vi.fn()
        .mockResolvedValueOnce({ price: 100 })
        .mockRejectedValueOnce(error),
      onData,
      onError,
      immediate: false,
    })

    await expect(subscription.refreshNow()).resolves.toEqual({ price: 100 })
    await expect(subscription.refreshNow()).resolves.toBeNull()

    expect(onData).toHaveBeenCalledWith({ price: 100 })
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('keeps existing watchlist and market overview service behavior working', async () => {
    const service = createMarketDataService({ finnhubApiKey: '', twelveDataApiKey: '' })
    const watchlist = await service.getWatchlistQuotes()
    const quote = await service.getQuote('AAPL')
    const marketStatus = await service.getMarketStatus()

    expect(watchlist.length).toBeGreaterThan(0)
    expect(watchlist[0]).toMatchObject({
      symbol: expect.any(String),
      price: expect.any(Number),
      health: {
        available: true,
      },
    })
    expect(quote).toMatchObject({
      symbol: 'AAPL',
      provider: 'mock',
      health: {
        available: true,
      },
    })
    expect(marketStatus.ok).toBe(true)
  })
})
