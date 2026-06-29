import { describe, expect, it } from 'vitest'
import { createMockMarketDataProvider } from '../lib/market/mockMarketDataProvider.js'
import { normalizeQuote } from '../lib/market/marketNormalizer.js'
import { createMarketDataService } from '../lib/market/marketDataService.js'

describe('market data layer', () => {
  it('returns a normalized quote shape from the mock provider', async () => {
    const provider = createMockMarketDataProvider()
    const result = await provider.getQuote('AAPL')

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      symbol: 'AAPL',
      price: expect.any(Number),
      open: expect.any(Number),
      high: expect.any(Number),
      low: expect.any(Number),
      previousClose: expect.any(Number),
      change: expect.any(Number),
      changePercent: expect.any(Number),
      volume: expect.any(Number),
    })
  })

  it('normalizes quotes into the service contract', () => {
    const normalized = normalizeQuote({
      symbol: 'SPY',
      price: 510,
      open: 508,
      high: 512,
      low: 507,
      previousClose: 509,
      change: 1,
      changePercent: 0.2,
      volume: 1200000,
    }, 'mock')

    expect(normalized).toEqual({
      symbol: 'SPY',
      price: 510,
      open: 508,
      high: 512,
      low: 507,
      previousClose: 509,
      change: 1,
      changePercent: 0.2,
      volume: 1200000,
      provider: 'mock',
      updatedAt: expect.any(String),
    })
  })

  it('falls back to mock data when API keys are missing', async () => {
    const service = createMarketDataService({ finnhubApiKey: '', twelveDataApiKey: '' })
    const result = await service.getQuote('TSLA')

    expect(result.provider).toBe('mock')
    expect(result.symbol).toBe('TSLA')
    expect(result.health.available).toBe(true)
  })
})
