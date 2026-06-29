import { createFinnhubClient } from './finnhubClient.js'
import { createMockMarketDataProvider } from './mockMarketDataProvider.js'
import { createTwelveDataClient } from './twelveDataClient.js'
import { normalizeQuote } from './marketNormalizer.js'

const WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META']

export function createMarketDataService({
  finnhubApiKey = import.meta.env?.VITE_FINNHUB_API_KEY ?? '',
  twelveDataApiKey = import.meta.env?.VITE_TWELVEDATA_API_KEY ?? '',
  timeoutMs = 4000,
} = {}) {
  const finnhubClient = createFinnhubClient({ apiKey: finnhubApiKey, timeoutMs })
  const twelveDataClient = createTwelveDataClient({ apiKey: twelveDataApiKey, timeoutMs })
  const mockProvider = createMockMarketDataProvider()

  return {
    getWatchlistQuotes() {
      return Promise.all(WATCHLIST.map((symbol) => this.getQuote(symbol)))
    },

    async getQuote(symbol) {
      const normalizedSymbol = symbol?.toUpperCase()
      const providerCandidates = [
        { client: finnhubClient, provider: 'finnhub' },
        { client: twelveDataClient, provider: 'twelvedata' },
      ]

      for (const candidate of providerCandidates) {
        const response = await candidate.client.getQuote(normalizedSymbol)
        if (response?.ok) {
          return {
            ...normalizeQuote(response.data, candidate.provider),
            health: {
              status: 'healthy',
              available: true,
              provider: candidate.provider,
            },
          }
        }
      }

      const fallback = await mockProvider.getQuote(normalizedSymbol)
      if (fallback?.ok) {
        return {
          ...normalizeQuote(fallback.data, fallback.provider),
          health: {
            status: 'healthy',
            available: true,
            provider: fallback.provider,
          },
        }
      }

      return {
        symbol: normalizedSymbol,
        price: 0,
        open: 0,
        high: 0,
        low: 0,
        previousClose: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        provider: 'mock',
        updatedAt: new Date().toISOString(),
        health: {
          status: 'degraded',
          available: false,
          provider: 'mock',
        },
      }
    },
  }
}
