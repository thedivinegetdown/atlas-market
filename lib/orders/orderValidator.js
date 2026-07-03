import { createErrorContract } from '../validation/errorContract.js'
import { validatePositiveNumber, validateRequired } from '../validation/commonValidators.js'
import { resolveOrderAsset, validateAssetQuantity } from '../assets/index.js'

export function validateOrderPayload(payload) {
  const required = validateRequired(payload?.symbol, 'symbol')
  if (required) {
    return required
  }

  if (!['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'].includes(payload?.type)) {
    return createErrorContract('invalid_order_type', 'order type is invalid')
  }

  if (!['BUY', 'SELL'].includes(payload?.side)) {
    return createErrorContract('invalid_order_side', 'order side is invalid')
  }

  const asset = resolveOrderAsset(payload)
  const quantityError = validatePositiveNumber(Number(payload?.quantity), asset.profile.quantityTerm)
  if (quantityError) {
    return quantityError
  }

  const assetQuantity = validateAssetQuantity(Number(payload?.quantity), asset.profile)
  if (!assetQuantity.ok) {
    return createErrorContract('invalid_quantity_increment', assetQuantity.message)
  }

  const priceError = validatePositiveNumber(Number(payload?.price), 'price')
  if (priceError) {
    return priceError
  }

  return null
}
