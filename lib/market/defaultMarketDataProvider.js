import { ASSET_TYPES, normalizeAssetType } from '../assets/index.js'
import { serverLogger } from '../logging/logger.js'
import { createFinnhubClient } from './finnhubClient.js'
import { createMockMarketDataProvider } from './mockMarketDataProvider.js'
import { createTwelveDataClient } from './twelveDataClient.js'
import {
  createProviderMetadata,
  MARKET_DATA_CAPABILITIES,
  normalizeProviderError,
  normalizeQuoteResponse,
} from './providerContract.js'

function toServiceQuote(response) {
  return {
    ...response.data,
    provider: response.provider,
    assetType: response.assetType,
    health: {
      status: 'healthy',
      available: true,
      provider: response.provider,
      receivedAt: response.receivedAt,
    },
  }
}

export function createDefaultMarketDataProvider({
  finnhubApiKey = import.meta.env?.VITE_FINNHUB_API_KEY ?? '',
  twelveDataApiKey = import.meta.env?.VITE_TWELVEDATA_API_KEY ?? '',
  timeoutMs = 4000,
  logger = serverLogger,
} = {}) {
  const providerId = 'atlas-default'
  const finnhubClient = createFinnhubClient({ apiKey: finnhubApiKey, timeoutMs })
  const twelveDataClient = createTwelveDataClient({ apiKey: twelveDataApiKey, timeoutMs })
  const mockProvider = createMockMarketDataProvider()

  return {
    metadata: createProviderMetadata({
      id: providerId,
      name: 'Atlas Default Market Data',
      assetTypes: [ASSET_TYPES.EQUITY, ASSET_TYPES.ETF],
      capabilities: [
        MARKET_DATA_CAPABILITIES.QUOTES,
        MARKET_DATA_CAPABILITIES.CANDLES,
        MARKET_DATA_CAPABILITIES.MARKET_STATUS,
      ],
      priority: 10,
    }),

    async getQuote(symbol, options = {}) {
      const normalizedSymbol = String(symbol ?? '').trim().toUpperCase()
      const assetType = normalizeAssetType(options.assetType)
      const providerCandidates = [
        { client: finnhubClient, provider: 'finnhub' },
        { client: twelveDataClient, provider: 'twelvedata' },
      ]

      for (const candidate of providerCandidates) {
        try {
          const response = await candidate.client.getQuote(normalizedSymbol)
          if (response?.ok) {
            return normalizeQuoteResponse(response.data, candidate.provider, { assetType })
          }
        } catch (error) {
          logger.warn('market data provider failed', {
            providerId: candidate.provider,
            symbol: normalizedSymbol,
            message: error instanceof Error ? error.message : 'quote failed',
          })
        }
      }

      const fallback = await mockProvider.getQuote(normalizedSymbol)
      if (fallback?.ok) {
        return normalizeQuoteResponse(fallback.data, fallback.provider, { assetType })
      }

      return normalizeProviderError('unsupported_symbol', 'symbol is not supported', providerId)
    },

    async getQuotes(symbols = [], options = {}) {
      const quotes = await Promise.all(symbols.map((symbol) => this.getQuote(symbol, options)))
      const failures = quotes.filter((quote) => !quote.ok)

      if (failures.length === quotes.length) {
        return normalizeProviderError('quotes_unavailable', 'quotes are unavailable', providerId)
      }

      return {
        ok: true,
        provider: providerId,
        assetType: normalizeAssetType(options.assetType),
        data: quotes.filter((quote) => quote.ok).map(toServiceQuote),
        errors: failures.map((failure) => failure.error),
        receivedAt: new Date().toISOString(),
      }
    },

    async getCandles(symbol, options = {}) {
      const quote = await this.getQuote(symbol, options)
      if (!quote.ok) return quote

      return {
        ok: true,
        provider: providerId,
        assetType: normalizeAssetType(options.assetType),
        data: [{
          symbol: quote.data.symbol,
          open: quote.data.open,
          high: quote.data.high,
          low: quote.data.low,
          close: quote.data.price,
          volume: quote.data.volume,
          timestamp: quote.data.updatedAt,
        }],
        receivedAt: new Date().toISOString(),
      }
    },

    async getMarketStatus() {
      const now = new Date()
      const day = now.getDay()
      const minutes = now.getHours() * 60 + now.getMinutes()
      const open = 9 * 60 + 30
      const close = 16 * 60
      const isOpen = day >= 1 && day <= 5 && minutes >= open && minutes < close

      return {
        ok: true,
        provider: providerId,
        data: {
          status: isOpen ? 'open' : 'closed',
          isOpen,
          session: 'us_regular',
          timestamp: now.toISOString(),
        },
        receivedAt: new Date().toISOString(),
      }
    },
  }
}

export function toMarketServiceQuote(providerResponse, symbol) {
  if (providerResponse?.ok) {
    return toServiceQuote(providerResponse)
  }

  const normalizedSymbol = String(symbol ?? '').trim().toUpperCase()
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
    provider: providerResponse?.provider ?? 'unknown',
    updatedAt: new Date().toISOString(),
    health: {
      status: 'degraded',
      available: false,
      provider: providerResponse?.provider ?? 'unknown',
    },
  }
}
