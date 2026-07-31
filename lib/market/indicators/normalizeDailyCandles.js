import { normalizeHistoricalDailyCandles } from '../historicalCandleNormalizer.js'

function isCurrentTradingDate(timestamp, now) {
  return timestamp.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
}

export function normalizeDailyCandles(rawCandles = [], {
  symbol,
  source = 'unknown',
  now = new Date(),
  marketOpen = false,
} = {}) {
  const canonical = normalizeHistoricalDailyCandles(rawCandles.map((raw) => ({
    ...raw,
    close: raw?.close ?? raw?.price,
  })), { symbol, provider: source, minimumCount: 0 })
  const invalid = [...canonical.invalid]
  const candles = canonical.candles.filter((candle, index) => {
    if (candle.completed === undefined) candle.completed = !(marketOpen && isCurrentTradingDate(candle.timestamp, now))
    if (!candle.completed) {
      invalid.push({ index, timestamp: candle.timestamp, reason: 'incomplete_current_candle' })
      return false
    }
    return true
  })
  return {
    candles,
    invalid,
    duplicateCount: canonical.duplicateCount,
    warnings: [
      ...(invalid.length ? [`Excluded ${invalid.length} invalid or incomplete daily candles`] : []),
      ...(canonical.duplicateCount ? [`Resolved ${canonical.duplicateCount} duplicate candle timestamps using the last normalized record`] : []),
    ],
  }
}
