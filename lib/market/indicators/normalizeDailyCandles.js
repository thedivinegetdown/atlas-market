function number(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function validCandle(candle) {
  return [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0
    && candle.high >= candle.low && candle.high >= candle.open && candle.high >= candle.close
    && candle.low <= candle.open && candle.low <= candle.close && candle.volume >= 0
}

function isCurrentTradingDate(timestamp, now) {
  return timestamp.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
}

export function normalizeDailyCandles(rawCandles = [], {
  symbol,
  source = 'unknown',
  now = new Date(),
  marketOpen = false,
} = {}) {
  const invalid = []
  const normalized = []
  for (const [index, raw] of rawCandles.entries()) {
    const date = new Date(raw?.timestamp ?? raw?.updatedAt ?? raw?.datetime)
    const timestamp = Number.isNaN(date.getTime()) ? null : date.toISOString()
    const candle = {
      timestamp,
      open: number(raw?.open),
      high: number(raw?.high),
      low: number(raw?.low),
      close: number(raw?.close ?? raw?.price),
      volume: number(raw?.volume),
      symbol: String(raw?.symbol ?? symbol ?? '').trim().toUpperCase(),
      timeframe: '1D',
      source: raw?.provider ?? raw?.source ?? source,
      completed: raw?.completed ?? raw?.complete,
    }
    if (!timestamp || !candle.symbol || !validCandle(candle)) {
      invalid.push({ index, timestamp, reason: 'invalid_daily_candle' })
      continue
    }
    if (candle.completed === undefined) candle.completed = !(marketOpen && isCurrentTradingDate(timestamp, now))
    if (!candle.completed) {
      invalid.push({ index, timestamp, reason: 'incomplete_current_candle' })
      continue
    }
    normalized.push(candle)
  }

  normalized.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  const byTimestamp = new Map()
  for (const candle of normalized) byTimestamp.set(candle.timestamp, candle)
  const candles = [...byTimestamp.values()]
  const duplicateCount = normalized.length - candles.length
  return {
    candles,
    invalid,
    duplicateCount,
    warnings: [
      ...(invalid.length ? [`Excluded ${invalid.length} invalid or incomplete daily candles`] : []),
      ...(duplicateCount ? [`Resolved ${duplicateCount} duplicate candle timestamps using the last normalized record`] : []),
    ],
  }
}
