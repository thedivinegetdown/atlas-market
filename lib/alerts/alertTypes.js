export const ALERT_TYPES = Object.freeze({
  PRICE_ABOVE: 'price_above',
  PRICE_BELOW: 'price_below',
  PERCENT_CHANGE: 'percent_change',
  VOLUME_ABOVE: 'volume_above',
  SIGNAL_CHANGE: 'signal_change',
  RISK_LIMIT: 'risk_limit',
  PORTFOLIO_DRAWDOWN: 'portfolio_drawdown',
})

export const SUPPORTED_ALERT_TYPES = Object.freeze(Object.values(ALERT_TYPES))

export function isSupportedAlertType(alertType) {
  return SUPPORTED_ALERT_TYPES.includes(String(alertType ?? '').trim().toLowerCase())
}
