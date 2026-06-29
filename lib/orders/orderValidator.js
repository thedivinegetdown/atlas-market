import { createErrorContract } from '../validation/errorContract.js'
import { validatePositiveNumber, validateRequired } from '../validation/commonValidators.js'

export function validateOrderPayload(payload) {
  const required = validateRequired(payload?.symbol, 'symbol')
  if (required) {
    return required
  }

  if (!['MARKET', 'LIMIT', 'STOP'].includes(payload?.type)) {
    return createErrorContract('invalid_order_type', 'order type is invalid')
  }

  if (!['BUY', 'SELL'].includes(payload?.side)) {
    return createErrorContract('invalid_order_side', 'order side is invalid')
  }

  const quantityError = validatePositiveNumber(Number(payload?.quantity), 'quantity')
  if (quantityError) {
    return quantityError
  }

  const priceError = validatePositiveNumber(Number(payload?.price), 'price')
  if (priceError) {
    return priceError
  }

  return null
}
