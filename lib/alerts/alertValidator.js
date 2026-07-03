import { validateAssetType, requireSymbol } from '../validation/requestValidators.js'
import { assertSafePayload } from '../security/requestGuards.js'
import { ALERT_TYPES, isSupportedAlertType } from './alertTypes.js'

const numericThresholdTypes = new Set([
  ALERT_TYPES.PRICE_ABOVE,
  ALERT_TYPES.PRICE_BELOW,
  ALERT_TYPES.PERCENT_CHANGE,
  ALERT_TYPES.VOLUME_ABOVE,
  ALERT_TYPES.RISK_LIMIT,
  ALERT_TYPES.PORTFOLIO_DRAWDOWN,
])

function failure(code, message) {
  return {
    ok: false,
    error: { code, message },
  }
}

function validateNotificationChannels(channels = { inApp: true }) {
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
    return failure('invalid_notification_channels', 'notification channels must be an object')
  }

  const normalized = {
    inApp: channels.inApp !== false,
  }

  return { ok: true, channels: normalized }
}

export function validateAlertPayload(payload = {}) {
  try {
    assertSafePayload(payload)
  } catch {
    return failure('unsafe_payload_key', 'request payload contains an unsafe key')
  }

  const alertType = String(payload.alertType ?? '').trim().toLowerCase()
  if (!isSupportedAlertType(alertType)) {
    return failure('invalid_alert_type', 'alert type is invalid')
  }

  const symbol = requireSymbol(payload.symbol)
  if (!symbol.ok) return symbol

  const assetType = validateAssetType(payload.assetType)
  if (!assetType.ok) return assetType

  if (typeof payload.enabled !== 'undefined' && typeof payload.enabled !== 'boolean') {
    return failure('invalid_enabled_state', 'enabled must be true or false')
  }

  let threshold = payload.threshold
  if (numericThresholdTypes.has(alertType)) {
    threshold = Number(threshold)
    if (!Number.isFinite(threshold)) {
      return failure('invalid_threshold', 'threshold must be a valid number')
    }
  } else if (alertType === ALERT_TYPES.SIGNAL_CHANGE) {
    threshold = String(threshold ?? '').trim().toUpperCase()
    if (!threshold) {
      return failure('invalid_threshold', 'signal threshold is required')
    }
  }

  const channels = validateNotificationChannels(payload.channels ?? payload.notificationChannels ?? { inApp: true })
  if (!channels.ok) return channels

  return {
    ok: true,
    alert: {
      symbol: symbol.symbol,
      assetType: assetType.assetType,
      alertType,
      threshold,
      enabled: payload.enabled !== false,
      channels: channels.channels,
      label: String(payload.label ?? `${symbol.symbol} ${alertType}`).trim(),
    },
  }
}
