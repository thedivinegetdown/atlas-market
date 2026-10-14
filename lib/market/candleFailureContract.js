// Only stable, non-sensitive service codes may cross into durable review results.
export const CANDLE_FAILURE_CODES = Object.freeze([
  'provider_unavailable',
  'provider_failed',
  'unsupported_provider_capability',
  'unsupported_symbol',
  'unsupported_interval',
  'unsupported_history_size',
  'unsupported_history_range',
  'missing_api_key',
  'credit_minute_budget_exceeded',
  'credit_daily_budget_exceeded',
  'provider_backoff_active',
  'provider_rate_limited',
  'provider_timeout',
  'request_failed',
  'provider_response_error',
  'malformed_provider_response',
  'historical_data_unavailable',
  'empty_candle_result',
  'malformed_candle_result',
  'unknown',
])

const CODES = new Set(CANDLE_FAILURE_CODES)

export function safeCandleFailureCode(code) {
  return typeof code === 'string' && CODES.has(code) ? code : 'unknown'
}

export function classifyCandleFailure(result) {
  if (result?.ok === true) {
    if (!Array.isArray(result.data)) return 'malformed_candle_result'
    return result.data.length === 0 ? 'empty_candle_result' : null
  }
  return safeCandleFailureCode(result?.error?.code)
}
