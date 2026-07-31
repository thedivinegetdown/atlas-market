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
import { normalizeHistoricalDailyCandles, normalizeHistoricalInterval } from './historicalCandleNormalizer.js'
import { createHistoricalRequestBudget } from './historicalRequestBudget.js'

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
  finnhubApiKey = '',
  twelveDataApiKey = '',
  timeoutMs = 4000,
  logger = serverLogger,
  historicalCacheTtlMs = 5 * 60 * 1000,
  historicalBudget = createHistoricalRequestBudget({
    dailyLimit: typeof process !== 'undefined' ? process.env.TWELVEDATA_DAILY_REQUEST_BUDGET : undefined,
    minuteLimit: typeof process !== 'undefined' ? process.env.TWELVEDATA_MINUTE_REQUEST_BUDGET : undefined,
  }),
  fetchImpl = globalThis.fetch,
} = {}) {
  const providerId = 'atlas-default'
  const finnhubClient = createFinnhubClient({ apiKey: finnhubApiKey, timeoutMs })
  const twelveDataClient = createTwelveDataClient({ apiKey: twelveDataApiKey, timeoutMs, fetchImpl })
  const mockProvider = createMockMarketDataProvider()
  const historicalCache = new Map()
  const historicalInFlight = new Map()
  let providerBlockedUntil = 0

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
      const normalizedSymbol = String(symbol ?? '').trim().toUpperCase()
      const interval = normalizeHistoricalInterval(options.interval)
      if (!interval) return normalizeProviderError('unsupported_interval', 'historical candles support only daily intervals', providerId)
      const requestedCount = Number(options.limit ?? 260)
      if (requestedCount !== 260) return normalizeProviderError('unsupported_history_size', 'historical requests require exactly 260 daily candles', providerId)
      if (options.startDate || options.endDate || options.start || options.end || options.range) {
        return normalizeProviderError('unsupported_history_range', 'custom historical ranges are not supported', providerId)
      }
      const cacheKey = `${normalizedSymbol}:${interval}:${requestedCount}`
      const cached = historicalCache.get(cacheKey)
      const cacheAgeMs = cached ? Date.now() - cached.cachedAt : Infinity
      if (cached && cacheAgeMs <= historicalCacheTtlMs) {
        logger.info('historical market data cache hit', {
          providerId: cached.response.provider,
          symbol: normalizedSymbol,
          candleCount: cached.response.candleCount,
          cacheAgeMs,
          historyCompleteness: cached.response.historyCompleteness,
        })
        return {
          ...cached.response,
          cache: { state: 'HIT', cachedAt: new Date(cached.cachedAt).toISOString(), ageMs: cacheAgeMs },
        }
      }
      logger.info('historical market data cache miss', { providerId, symbol: normalizedSymbol, requestedCount })
      const inFlight = historicalInFlight.get(cacheKey)
      if (inFlight) {
        logger.info('historical provider request avoided through deduplication', {
          providerId: 'twelvedata',
          symbol: normalizedSymbol,
          requestedCount,
        })
        return inFlight
      }
      const now = Date.now()
      if (providerBlockedUntil > now) {
        const retryAfterSeconds = Math.max(1, Math.ceil((providerBlockedUntil - now) / 1000))
        logger.warn('historical provider request blocked by retry-after', { providerId: 'twelvedata', symbol: normalizedSymbol, retryAfterSeconds })
        return {
          ...normalizeProviderError('provider_backoff_active', 'historical provider retry window is active', providerId),
          statusCode: 429,
          retryAfterSeconds,
          budget: historicalBudget.inspect(),
        }
      }
      const budgetDecision = historicalBudget.consume()
      if (!budgetDecision.ok) {
        logger.warn('historical provider request rejected by process-local budget', {
          providerId: 'twelvedata',
          symbol: normalizedSymbol,
          code: budgetDecision.code,
          retryAfterSeconds: budgetDecision.retryAfterSeconds,
          budgetScope: 'process-local',
        })
        return {
          ...normalizeProviderError(budgetDecision.code, 'historical request budget is exhausted', providerId),
          statusCode: 429,
          retryAfterSeconds: budgetDecision.retryAfterSeconds,
          budget: budgetDecision.budget,
        }
      }
      logger.info('historical provider request attempted', {
        providerId: 'twelvedata',
        symbol: normalizedSymbol,
        requestedCount,
        budgetScope: 'process-local',
      })
      const request = (async () => {
        const response = await twelveDataClient.getCandles(normalizedSymbol, { ...options, interval, limit: requestedCount })
      const fallbackAttempts = [
        { provider: 'twelvedata', status: response.ok ? 'selected' : response.error?.code ?? 'failed' },
        { provider: 'finnhub', status: 'skipped_premium_history' },
        { provider: 'mock', status: 'skipped_synthetic_history' },
      ]
      if (!response.ok) {
        if (response.error?.code === 'provider_rate_limited' && response.retryAfterSeconds) {
          providerBlockedUntil = Date.now() + (response.retryAfterSeconds * 1000)
        }
        logger.warn('historical market data unavailable', {
          providerId: response.provider,
          symbol: normalizedSymbol,
          code: response.error?.code,
          rateLimited: response.error?.code === 'provider_rate_limited',
          durationMs: response.durationMs,
          retryAfterSeconds: response.retryAfterSeconds ?? null,
        })
        return {
          ...normalizeProviderError(response.error?.code ?? 'historical_data_unavailable', response.error?.message ?? 'historical data is unavailable', providerId),
          warnings: ['No approved free fallback provider returned genuine historical daily candles'],
          fallbackUsed: false,
          fallbackAttempts,
          durationMs: response.durationMs,
          retryAfterSeconds: response.retryAfterSeconds ?? null,
          statusCode: response.status === 429 ? 429 : undefined,
        }
      }
      const normalized = normalizeHistoricalDailyCandles(response.data, {
        symbol: normalizedSymbol,
        provider: response.provider,
        minimumCount: requestedCount,
      })
      logger.info('historical market data retrieved', {
        providerId: response.provider,
        symbol: normalizedSymbol,
        candleCount: normalized.candles.length,
        fallbackUsed: false,
        durationMs: response.durationMs,
        historyCompleteness: normalized.historyCompleteness,
      })
      const result = {
        ok: true,
        provider: response.provider,
        assetType: normalizeAssetType(options.assetType),
        data: normalized.candles,
        receivedAt: response.receivedAt,
        durationMs: response.durationMs,
        candleCount: normalized.candles.length,
        historyCompleteness: normalized.historyCompleteness,
        warnings: normalized.warnings,
        invalidCandles: normalized.invalid,
        duplicateCount: normalized.duplicateCount,
        requestedCount,
        fallbackUsed: false,
        fallbackAttempts,
        cache: { state: 'MISS', cachedAt: null, ageMs: 0 },
      }
      historicalCache.set(cacheKey, { cachedAt: Date.now(), response: result })
      return result
      })()
      historicalInFlight.set(cacheKey, request)
      try {
        return await request
      } finally {
        historicalInFlight.delete(cacheKey)
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
