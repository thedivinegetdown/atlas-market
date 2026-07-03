import { getAssetProfile } from './assetProfiles.js'
import { getSymbolMetadata } from './symbolMetadata.js'

function decimalPlaces(value) {
  const text = String(value)
  if (!text.includes('.')) return 0
  return text.split('.')[1].length
}

function isMultipleOfStep(value, step) {
  const scale = 10 ** Math.max(decimalPlaces(value), decimalPlaces(step))
  return Math.round(value * scale) % Math.round(step * scale) === 0
}

export function getQuantityLabel(assetType, quantity = 2) {
  const profile = getAssetProfile(assetType)
  return Number(quantity) === 1 ? profile.singularQuantityTerm : profile.quantityTerm
}

export function getQuantityStep(assetType) {
  return getAssetProfile(assetType).quantityStep
}

export function validateAssetQuantity(quantity, profile) {
  const numericQuantity = Number(quantity)
  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
    return {
      ok: false,
      message: `${profile.quantityTerm} must be greater than zero`,
    }
  }

  if (!profile.allowFractionalQuantity && !Number.isInteger(numericQuantity)) {
    return {
      ok: false,
      message: `${profile.quantityTerm} must be a whole number`,
    }
  }

  if (!isMultipleOfStep(numericQuantity, profile.quantityStep)) {
    return {
      ok: false,
      message: `${profile.quantityTerm} must use increments of ${profile.quantityStep}`,
    }
  }

  return { ok: true }
}

export function getPricePrecision(assetType) {
  return getAssetProfile(assetType).pricePrecision
}

export function getTickSize(assetType) {
  return getAssetProfile(assetType).tickSize
}

export function roundPriceForAsset(price, assetType) {
  const profile = getAssetProfile(assetType)
  const tickSize = Number(profile.tickSize)
  const precision = Number(profile.pricePrecision)
  const roundedToTick = Math.round(Number(price) / tickSize) * tickSize
  return Number(roundedToTick.toFixed(precision))
}

export function formatPriceForAsset(price, assetType) {
  return roundPriceForAsset(price, assetType).toFixed(getPricePrecision(assetType))
}

export function getTradingSession(assetType) {
  return getAssetProfile(assetType).tradingSession
}

export function getMarginConfig(assetType) {
  return getAssetProfile(assetType).margin
}

export function calculateOrderNotional(order = {}, profile = getAssetProfile()) {
  const quantity = Number(order.quantity ?? 0)
  const price = Number(order.price ?? 0)
  const multiplier = Number(profile.contractMultiplier ?? 1)
  return quantity * price * multiplier
}

export function resolveOrderAsset(order = {}, quote = {}) {
  const symbol = order.symbol ?? quote.symbol
  const metadata = getSymbolMetadata(symbol, order.assetType ?? quote.assetType)
  return {
    ...metadata,
    notional: calculateOrderNotional(order, metadata.profile),
    quantityLabel: getQuantityLabel(metadata.assetType, order.quantity),
    pricePrecision: metadata.profile.pricePrecision,
    tickSize: metadata.profile.tickSize,
    margin: metadata.profile.margin,
    tradingSession: metadata.profile.tradingSession,
  }
}
