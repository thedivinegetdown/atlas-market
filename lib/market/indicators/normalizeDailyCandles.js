import { normalizeHistoricalDailyCandles } from '../historicalCandleNormalizer.js'

export const DAILY_COMPLETION_STATUS = Object.freeze({
  COMPLETED: 'CONFIRMED_COMPLETED',
  INCOMPLETE: 'CONFIRMED_INCOMPLETE',
  UNKNOWN: 'UNKNOWN',
})

export function normalizeDailyCandles(rawCandles = [], {
  symbol,
  source = 'unknown',
  now = new Date(),
} = {}) {
  const canonical = normalizeHistoricalDailyCandles(rawCandles.map((raw) => ({
    ...raw,
    close: raw?.close ?? raw?.price,
  })), { symbol, provider: source, minimumCount: 0 })
  const invalid = [...canonical.invalid]
  const evaluatedAt = new Date(now).toISOString()
  // No independently qualified daily-completion verifier is registered. Neither
  // a provider boolean, a dated bar, nor the local-clock market-status heuristic
  // is a completion receipt. Do not reuse PA.4 exit receipts for adjusted daily
  // OHLCV: they bind a different instrument/price/time contract.
  const assessed = canonical.candles.map((candle, index) => {
    const completionStatus = DAILY_COMPLETION_STATUS.UNKNOWN
    invalid.push({
      index,
      timestamp: candle.timestamp,
      sessionDate: candle.timestamp.slice(0, 10),
      source: candle.source,
      evaluatedAt,
      declaredCompleted: typeof candle.completed === 'boolean' ? candle.completed : null,
      completionStatus,
      reason: 'unqualified_daily_completion',
    })
    return { ...candle, completed: undefined, completionStatus }
  })
  const candles = assessed.filter((candle) => candle.completionStatus === DAILY_COMPLETION_STATUS.COMPLETED)
  return {
    candles,
    invalid,
    completion: {
      status: DAILY_COMPLETION_STATUS.UNKNOWN,
      reason: 'daily_completion_unqualified',
      evaluatedAt,
      sourceSessionDate: canonical.candles.at(-1)?.timestamp.slice(0, 10) ?? null,
      assessedCandleCount: assessed.length,
      confirmedCompletedCount: 0,
      confirmedIncompleteCount: 0,
      unknownCount: assessed.length,
    },
    duplicateCount: canonical.duplicateCount,
    warnings: [
      'Daily session completion is not independently qualified; completed-session evidence is unavailable',
      ...(invalid.length ? [`Excluded ${invalid.length} invalid or unqualified daily candles`] : []),
      ...(canonical.duplicateCount ? [`Resolved ${canonical.duplicateCount} duplicate candle timestamps using the last normalized record`] : []),
    ],
  }
}
