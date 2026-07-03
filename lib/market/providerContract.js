import { ASSET_TYPES, normalizeAssetType } from '../assets/index.js'
import { normalizeQuote } from './marketNormalizer.js'

export const MARKET_DATA_CAPABILITIES = Object.freeze({
  QUOTES: 'quotes',
  CANDLES: 'candles',
  MARKET_STATUS: 'market_status',
})

export function createProviderMetadata({
  id,
  name = id,
  assetTypes = [ASSET_TYPES.EQUITY, ASSET_TYPES.ETF],
  capabilities = [MARKET_DATA_CAPABILITIES.QUOTES],
  priority = 100,
} = {}) {
  return Object.freeze({
    id,
    name,
    assetTypes: assetTypes.map(normalizeAssetType),
    capabilities,
    priority,
  })
}

export function normalizeQuoteResponse(rawQuote, providerId, options = {}) {
  return {
    ok: true,
    provider: providerId,
    assetType: normalizeAssetType(options.assetType),
    data: normalizeQuote(rawQuote, providerId),
    receivedAt: new Date().toISOString(),
  }
}

export function normalizeProviderError(code, message, providerId) {
  return {
    ok: false,
    provider: providerId,
    error: {
      code,
      message,
    },
    receivedAt: new Date().toISOString(),
  }
}

export function createUnsupportedCapabilityError(providerId, capability) {
  return normalizeProviderError(
    'unsupported_provider_capability',
    `provider does not support ${capability}`,
    providerId
  )
}
