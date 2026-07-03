import { ASSET_TYPES, normalizeAssetType } from './assetTypes.js'
import { getAssetProfile } from './assetProfiles.js'

const forexPairPattern = /^([A-Z]{3})\/?([A-Z]{3})$/
const commonForexCodes = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'])

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function inferAssetType(symbol, explicitAssetType) {
  if (explicitAssetType) return normalizeAssetType(explicitAssetType)

  const normalized = normalizeSymbol(symbol)
  const forexMatch = normalized.match(forexPairPattern)
  if (forexMatch && commonForexCodes.has(forexMatch[1]) && commonForexCodes.has(forexMatch[2])) {
    return ASSET_TYPES.FOREX
  }

  if (normalized.includes('-USD') || normalized.includes('/USD')) {
    return ASSET_TYPES.CRYPTO
  }

  return ASSET_TYPES.EQUITY
}

function parseForexPair(symbol) {
  const match = normalizeSymbol(symbol).match(forexPairPattern)
  if (!match || !commonForexCodes.has(match[1]) || !commonForexCodes.has(match[2])) {
    return null
  }

  return {
    baseCurrency: match[1],
    quoteCurrency: match[2],
  }
}

export function getSymbolMetadata(symbol, explicitAssetType) {
  const normalized = normalizeSymbol(symbol)
  const assetType = inferAssetType(normalized, explicitAssetType)
  const profile = getAssetProfile(assetType)
  const forexPair = assetType === ASSET_TYPES.FOREX ? parseForexPair(normalized) : null

  return {
    symbol: normalized,
    assetType,
    profile,
    baseCurrency: forexPair?.baseCurrency ?? null,
    quoteCurrency: forexPair?.quoteCurrency ?? null,
  }
}

export function getAssetProfileForSymbol(symbol, explicitAssetType) {
  return getSymbolMetadata(symbol, explicitAssetType).profile
}
