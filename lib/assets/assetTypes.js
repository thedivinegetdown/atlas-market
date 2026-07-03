export const ASSET_TYPES = Object.freeze({
  EQUITY: 'equity',
  ETF: 'etf',
  FOREX: 'forex',
  CRYPTO: 'crypto',
  FUTURES: 'futures',
  OPTIONS: 'options',
})

export const SUPPORTED_ASSET_TYPES = Object.freeze(Object.values(ASSET_TYPES))

export function normalizeAssetType(assetType) {
  const normalized = String(assetType ?? '').trim().toLowerCase()
  return SUPPORTED_ASSET_TYPES.includes(normalized) ? normalized : ASSET_TYPES.EQUITY
}
