import { ASSET_TYPES, getSymbolMetadata, normalizeAssetType } from '../assets/index.js'
import { serverLogger } from '../logging/logger.js'
import { createDefaultMarketDataProvider, toMarketServiceQuote } from './defaultMarketDataProvider.js'
import { MARKET_DATA_CAPABILITIES, normalizeProviderError } from './providerContract.js'
import { createMarketDataProviderRegistry } from './providerRegistry.js'

const WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META']
let marketDataDiagnostics = {
  lastSuccessfulSync: null,
  lastProvider: null,
  lastError: null,
}

function updateDiagnostics(nextDiagnostics) {
  marketDataDiagnostics = {
    ...marketDataDiagnostics,
    ...nextDiagnostics,
  }
}

export function getMarketDataDiagnostics() {
  return marketDataDiagnostics
}

export function createMarketDataService({
  finnhubApiKey = (typeof process !== 'undefined' ? process.env.FINNHUB_API_KEY ?? process.env.VITE_FINNHUB_API_KEY : '') ?? '',
  twelveDataApiKey = (typeof process !== 'undefined' ? process.env.TWELVEDATA_API_KEY ?? process.env.VITE_TWELVEDATA_API_KEY : '') ?? '',
  timeoutMs = 4000,
  registry = createMarketDataProviderRegistry(),
  logger = serverLogger,
} = {}) {
  const defaultProvider = createDefaultMarketDataProvider({
    finnhubApiKey,
    twelveDataApiKey,
    timeoutMs,
    logger,
  })
  registry.register(defaultProvider)

  async function callProvider(capability, callback, options = {}) {
    const assetType = normalizeAssetType(options.assetType)
    const provider = registry.selectProvider({ assetType, capability })
    if (!provider) {
      const error = normalizeProviderError('provider_unavailable', 'market data provider is unavailable', 'registry')
      updateDiagnostics({ lastError: error.error.message })
      return error
    }

    try {
      const result = await callback(provider)
      if (result?.ok) {
        updateDiagnostics({
          lastSuccessfulSync: new Date().toISOString(),
          lastProvider: result.provider ?? provider.metadata.id,
          lastError: null,
        })
      } else {
        updateDiagnostics({
          lastError: result?.error?.message ?? 'market data request failed',
        })
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'market data provider failed'
      logger.warn('market data provider failure', {
        providerId: provider.metadata.id,
        assetType,
        capability,
        message,
      })
      updateDiagnostics({ lastError: message })
      return normalizeProviderError('provider_failed', 'market data provider failed', provider.metadata.id)
    }
  }

  return {
    registry,

    getWatchlistQuotes(options = {}) {
      return this.getQuotes(WATCHLIST, options)
    },

    async getQuote(symbol, options = {}) {
      const metadata = getSymbolMetadata(symbol, options.assetType)
      const response = await callProvider(
        MARKET_DATA_CAPABILITIES.QUOTES,
        (provider) => provider.getQuote(metadata.symbol, {
          ...options,
          assetType: metadata.assetType,
        }),
        { ...options, assetType: metadata.assetType }
      )

      return toMarketServiceQuote(response, metadata.symbol)
    },

    async getQuotes(symbols = [], options = {}) {
      const assetType = normalizeAssetType(options.assetType ?? ASSET_TYPES.EQUITY)
      const response = await callProvider(
        MARKET_DATA_CAPABILITIES.QUOTES,
        (provider) => provider.getQuotes(symbols, { ...options, assetType }),
        { ...options, assetType }
      )

      if (response?.ok) return response.data
      return Promise.all(symbols.map((symbol) => this.getQuote(symbol, options)))
    },

    getCandles(symbol, options = {}) {
      const metadata = getSymbolMetadata(symbol, options.assetType)
      return callProvider(
        MARKET_DATA_CAPABILITIES.CANDLES,
        (provider) => provider.getCandles(metadata.symbol, {
          ...options,
          assetType: metadata.assetType,
        }),
        { ...options, assetType: metadata.assetType }
      )
    },

    getMarketStatus(options = {}) {
      return callProvider(
        MARKET_DATA_CAPABILITIES.MARKET_STATUS,
        (provider) => provider.getMarketStatus(options),
        options
      )
    },
  }
}
