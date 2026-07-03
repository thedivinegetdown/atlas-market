import { SUPPORTED_ASSET_TYPES, normalizeAssetType } from '../assets/index.js'
import { validateOrderPayload as validateEngineOrderPayload } from '../orders/orderValidator.js'

function failure(code, message) {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  }
}

export function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

export function isValidSymbol(symbol) {
  return /^[A-Z][A-Z0-9.-]{0,19}$/.test(normalizeSymbol(symbol))
}

export function requireField(source, fieldName) {
  const value = source?.[fieldName]
  if (value === undefined || value === null || value === '') {
    return failure('required', `${fieldName} is required`)
  }

  return { ok: true, value }
}

export function requireSymbol(symbol) {
  const normalized = normalizeSymbol(symbol)

  if (!normalized) {
    return failure('missing_symbol', 'symbol is required')
  }

  if (!isValidSymbol(normalized)) {
    return failure('invalid_symbol', 'symbol is invalid')
  }

  return { ok: true, symbol: normalized }
}

export function validateAssetType(assetType) {
  if (assetType === undefined || assetType === null || assetType === '') {
    return { ok: true, assetType: normalizeAssetType() }
  }

  const normalized = String(assetType).trim().toLowerCase()
  if (!SUPPORTED_ASSET_TYPES.includes(normalized)) {
    return failure('invalid_asset_type', 'asset type is invalid')
  }

  return { ok: true, assetType: normalized }
}

export function validateNumberBounds(value, {
  fieldName,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  integer = false,
} = {}) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    return failure('invalid_number', `${fieldName} must be a valid number`)
  }

  if (integer && !Number.isInteger(numberValue)) {
    return failure('invalid_number', `${fieldName} must be a whole number`)
  }

  if (numberValue < min || numberValue > max) {
    return failure('number_out_of_bounds', `${fieldName} must be between ${min} and ${max}`)
  }

  return { ok: true, value: numberValue }
}

export function validatePagination(query = {}, {
  defaultPage = 1,
  defaultPageSize = 50,
  maxPageSize = 250,
} = {}) {
  const page = validateNumberBounds(query.page ?? defaultPage, {
    fieldName: 'page',
    min: 1,
    max: 100000,
    integer: true,
  })
  if (!page.ok) return page

  const pageSize = validateNumberBounds(query.pageSize ?? defaultPageSize, {
    fieldName: 'pageSize',
    min: 1,
    max: maxPageSize,
    integer: true,
  })
  if (!pageSize.ok) return pageSize

  return {
    ok: true,
    pagination: {
      page: page.value,
      pageSize: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
      limit: pageSize.value,
    },
  }
}

export function validateOrderPayload(payload = {}) {
  const symbol = requireSymbol(payload.symbol)
  if (!symbol.ok) return symbol

  const assetType = validateAssetType(payload.assetType)
  if (!assetType.ok) return assetType

  const engineValidation = validateEngineOrderPayload({
    ...payload,
    symbol: symbol.symbol,
    assetType: assetType.assetType,
  })
  if (engineValidation) {
    return failure(engineValidation.code, engineValidation.message)
  }

  return {
    ok: true,
    order: {
      ...payload,
      symbol: symbol.symbol,
      assetType: assetType.assetType,
    },
  }
}
