import { ASSET_TYPES, normalizeAssetType } from '../assets/index.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'
import {
  isMarketDataStale,
  normalizeCandle,
  normalizeQuote,
  normalizeSymbolMetadata,
} from './marketNormalizer.js'

export const MARKET_DATA_ADAPTER_CHECKED_EVENT = 'marketData.adapter.checked'

export const MARKET_DATA_ADAPTER_CAPABILITIES = Object.freeze({
  QUOTES: 'quotes',
  CANDLES: 'candles',
  SYMBOL_METADATA: 'symbol_metadata',
  HEALTH: 'health',
})

const defaultSymbols = Object.freeze(['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META'])

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildMockQuote(symbol, options = {}) {
  const normalizedSymbol = normalizeSymbol(symbol)
  const index = Math.max(0, defaultSymbols.indexOf(normalizedSymbol))
  const basePrice = numberValue(options.basePrice, 100 + index * 7)
  const price = Number((basePrice + (normalizedSymbol.length % 3) * 0.5).toFixed(2))
  const previousClose = Number((price - 0.3).toFixed(2))
  const change = Number((price - previousClose).toFixed(2))

  return {
    symbol: normalizedSymbol,
    assetType: normalizeAssetType(options.assetType),
    price,
    bid: Number((price - 0.02).toFixed(2)),
    ask: Number((price + 0.02).toFixed(2)),
    open: Number((price - 0.4).toFixed(2)),
    high: Number((price + 0.8).toFixed(2)),
    low: Number((price - 0.9).toFixed(2)),
    previousClose,
    change,
    changePercent: Number(((change / previousClose) * 100).toFixed(2)),
    volume: 1000000 + index * 25000,
    updatedAt: getNowIso(options.updatedAt),
  }
}

function normalizeAdapterError(error, adapterId) {
  const message = error instanceof Error ? error.message : String(error ?? 'market data adapter failed')
  return {
    ok: false,
    provider: adapterId,
    status: 'error',
    error: {
      code: 'market_data_adapter_error',
      message,
    },
    checkedAt: new Date().toISOString(),
  }
}

export function createMarketDataAdapterInterface(adapter) {
  const requiredMethods = ['getQuote', 'getQuotes', 'getCandles', 'getSymbolMetadata', 'checkHealth']
  const missing = requiredMethods.filter((method) => typeof adapter?.[method] !== 'function')

  if (missing.length > 0) {
    throw new Error(`market data adapter missing methods: ${missing.join(', ')}`)
  }

  return adapter
}

export function createMockMarketDataAdapter(options = {}) {
  const adapterId = options.id ?? 'mock-market-data-adapter'
  const eventBus = options.eventBus ?? defaultEventBus
  const symbols = options.symbols ?? defaultSymbols
  const staleAfterMs = numberValue(options.staleAfterMs, 90000)
  let lastSuccessfulSync = null
  let lastError = null

  function getMetadata() {
    return {
      id: adapterId,
      name: options.name ?? 'Atlas Mock Market Data Adapter',
      default: true,
      paperTrading: true,
      assetTypes: [
        ASSET_TYPES.EQUITY,
        ASSET_TYPES.ETF,
        ASSET_TYPES.FOREX,
        ASSET_TYPES.CRYPTO,
        ASSET_TYPES.FUTURES,
        ASSET_TYPES.OPTIONS,
      ],
      capabilities: Object.values(MARKET_DATA_ADAPTER_CAPABILITIES),
    }
  }

  function markSuccess(updatedAt) {
    lastSuccessfulSync = updatedAt ?? new Date().toISOString()
    lastError = null
  }

  return createMarketDataAdapterInterface({
    metadata: getMetadata(),

    getProviderHealth(healthOptions = {}) {
      const checkedAt = getNowIso(healthOptions.now)
      const stale = lastSuccessfulSync
        ? isMarketDataStale(lastSuccessfulSync, { staleAfterMs, now: healthOptions.now ?? new Date() })
        : false

      return {
        ok: true,
        provider: adapterId,
        status: stale ? 'stale' : 'healthy',
        available: true,
        paperTrading: true,
        stale,
        staleAfterMs,
        lastSuccessfulSync,
        lastError,
        checkedAt,
      }
    },

    async checkHealth(checkOptions = {}) {
      try {
        const health = {
          ...this.getProviderHealth(checkOptions),
        }

        if (eventBus?.emit) {
          eventBus.emit(MARKET_DATA_ADAPTER_CHECKED_EVENT, health)
        }

        return health
      } catch (error) {
        const normalized = normalizeAdapterError(error, adapterId)
        lastError = normalized.error.message
        if (eventBus?.emit) eventBus.emit(MARKET_DATA_ADAPTER_CHECKED_EVENT, normalized)
        return normalized
      }
    },

    async getQuote(symbol, quoteOptions = {}) {
      const normalizedSymbol = normalizeSymbol(symbol)
      if (!symbols.includes(normalizedSymbol) && !quoteOptions.allowUnsupportedSymbol) {
        const error = normalizeAdapterError(new Error('symbol is not supported by mock adapter'), adapterId)
        lastError = error.error.message
        return error
      }

      const quote = normalizeQuote(
        buildMockQuote(normalizedSymbol, quoteOptions),
        adapterId,
        { symbol: normalizedSymbol, assetType: quoteOptions.assetType },
      )
      quote.assetType = normalizeAssetType(quoteOptions.assetType)
      markSuccess(quote.updatedAt)

      return {
        ok: true,
        provider: adapterId,
        data: quote,
        health: this.getProviderHealth(),
        receivedAt: new Date().toISOString(),
      }
    },

    async getQuotes(requestedSymbols = [], quoteOptions = {}) {
      const results = await Promise.all(requestedSymbols.map((symbol) => this.getQuote(symbol, quoteOptions)))
      const data = results.filter((result) => result.ok).map((result) => result.data)
      const errors = results.filter((result) => !result.ok).map((result) => result.error)

      return {
        ok: data.length > 0,
        provider: adapterId,
        data,
        errors,
        health: this.getProviderHealth(),
        receivedAt: new Date().toISOString(),
      }
    },

    async getCandles(symbol, candleOptions = {}) {
      const quoteResponse = await this.getQuote(symbol, candleOptions)
      if (!quoteResponse.ok) return quoteResponse

      const candle = normalizeCandle({
        ...quoteResponse.data,
        close: quoteResponse.data.price,
        interval: candleOptions.interval ?? '1d',
      }, adapterId, candleOptions)

      return {
        ok: true,
        provider: adapterId,
        data: [candle],
        health: this.getProviderHealth(),
        receivedAt: new Date().toISOString(),
      }
    },

    async getSymbolMetadata(symbol, metadataOptions = {}) {
      return {
        ok: true,
        provider: adapterId,
        data: normalizeSymbolMetadata(symbol, metadataOptions),
        health: this.getProviderHealth(),
        receivedAt: new Date().toISOString(),
      }
    },
  })
}

export function createMarketDataAdapter(options = {}) {
  return createMockMarketDataAdapter(options)
}
