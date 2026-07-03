import { assertSafePayload } from '../security/requestGuards.js'
import { requireSymbol, validateAssetType } from '../validation/requestValidators.js'
import { SCANNER_CRITERIA, isSupportedScannerCriterion } from './scannerCriteria.js'

const thresholdCriteria = new Set([
  SCANNER_CRITERIA.PRICE_ABOVE,
  SCANNER_CRITERIA.PRICE_BELOW,
  SCANNER_CRITERIA.PERCENT_CHANGE_ABOVE,
  SCANNER_CRITERIA.PERCENT_CHANGE_BELOW,
  SCANNER_CRITERIA.VOLUME_ABOVE,
  SCANNER_CRITERIA.VOLATILITY_ABOVE,
])

function failure(code, message) {
  return { ok: false, error: { code, message } }
}

function validateUniverse(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return failure('invalid_symbol_universe', 'symbol universe must include at least one symbol')
  }

  const normalized = []
  for (const symbol of symbols) {
    const validation = requireSymbol(symbol)
    if (!validation.ok) return validation
    normalized.push(validation.symbol)
  }

  return { ok: true, symbols: [...new Set(normalized)] }
}

function validateCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return failure('invalid_scanner_criteria', 'criteria list must include at least one criterion')
  }

  const normalized = []
  for (const criterion of criteria) {
    const type = String(criterion?.type ?? '').trim().toLowerCase()
    if (!isSupportedScannerCriterion(type)) {
      return failure('invalid_scanner_criterion', 'scanner criterion is invalid')
    }

    let threshold = criterion.threshold
    if (thresholdCriteria.has(type)) {
      threshold = Number(threshold)
      if (!Number.isFinite(threshold)) {
        return failure('invalid_threshold', 'criterion threshold must be a valid number')
      }
    }

    normalized.push({ type, threshold })
  }

  return { ok: true, criteria: normalized }
}

export function validateScannerPayload(payload = {}) {
  try {
    assertSafePayload(payload)
  } catch {
    return failure('unsafe_payload_key', 'request payload contains an unsafe key')
  }

  const name = String(payload.name ?? '').trim()
  if (!name) {
    return failure('invalid_scanner_name', 'scanner name is required')
  }

  const assetType = validateAssetType(payload.assetType)
  if (!assetType.ok) return assetType

  const universe = validateUniverse(payload.symbols ?? payload.symbolUniverse)
  if (!universe.ok) return universe

  const criteria = validateCriteria(payload.criteria)
  if (!criteria.ok) return criteria

  if (typeof payload.enabled !== 'undefined' && typeof payload.enabled !== 'boolean') {
    return failure('invalid_enabled_state', 'enabled must be true or false')
  }

  return {
    ok: true,
    scanner: {
      name,
      assetType: assetType.assetType,
      symbols: universe.symbols,
      criteria: criteria.criteria,
      enabled: payload.enabled !== false,
    },
  }
}
