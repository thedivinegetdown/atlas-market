export const SCANNER_CRITERIA = Object.freeze({
  PRICE_ABOVE: 'price_above',
  PRICE_BELOW: 'price_below',
  PERCENT_CHANGE_ABOVE: 'percent_change_above',
  PERCENT_CHANGE_BELOW: 'percent_change_below',
  VOLUME_ABOVE: 'volume_above',
  SIGNAL_BULLISH: 'signal_bullish',
  SIGNAL_BEARISH: 'signal_bearish',
  VOLATILITY_ABOVE: 'volatility_above',
  RISK_ACCEPTABLE: 'risk_acceptable',
})

export const SUPPORTED_SCANNER_CRITERIA = Object.freeze(Object.values(SCANNER_CRITERIA))

export function isSupportedScannerCriterion(type) {
  return SUPPORTED_SCANNER_CRITERIA.includes(String(type ?? '').trim().toLowerCase())
}
