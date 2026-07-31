const DAILY_INTERVALS = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])

function numeric(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function timestamp(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return `${value.slice(0, 10)}T00:00:00.000Z`
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function valid(candle) {
  return [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0
    && candle.high >= candle.low && candle.high >= candle.open && candle.high >= candle.close
    && candle.low <= candle.open && candle.low <= candle.close && candle.volume >= 0
}

export function normalizeHistoricalDailyCandles(rawCandles = [], {
  symbol,
  provider = 'unknown',
  minimumCount = 260,
} = {}) {
  const invalid = []
  const normalized = []
  for (const [index, raw] of (Array.isArray(rawCandles) ? rawCandles : []).entries()) {
    const candle = {
      timestamp: timestamp(raw?.timestamp ?? raw?.datetime ?? raw?.time),
      open: numeric(raw?.open),
      high: numeric(raw?.high),
      low: numeric(raw?.low),
      close: numeric(raw?.close),
      volume: numeric(raw?.volume),
      symbol: String(raw?.symbol ?? symbol ?? '').trim().toUpperCase(),
      interval: '1d',
      timeframe: '1D',
      provider: raw?.provider ?? raw?.source ?? provider,
      source: raw?.provider ?? raw?.source ?? provider,
      completed: raw?.completed ?? raw?.complete,
    }
    if (!candle.timestamp || !candle.symbol || !valid(candle)) {
      invalid.push({ index, timestamp: candle.timestamp, reason: 'invalid_daily_candle' })
      continue
    }
    normalized.push(candle)
  }
  normalized.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  const byTimestamp = new Map()
  for (const candle of normalized) byTimestamp.set(candle.timestamp, candle)
  const candles = [...byTimestamp.values()]
  const duplicateCount = normalized.length - candles.length
  const truncated = candles.length < minimumCount
  return {
    candles,
    invalid,
    duplicateCount,
    truncated,
    requestedCount: minimumCount,
    historyCompleteness: truncated ? 'TRUNCATED' : 'COMPLETE',
    warnings: [
      ...(invalid.length ? [`Excluded ${invalid.length} invalid daily candles`] : []),
      ...(duplicateCount ? [`Resolved ${duplicateCount} duplicate timestamps using the last provider record`] : []),
      ...(truncated ? [`Historical response contained ${candles.length} of ${minimumCount} requested daily candles`] : []),
    ],
  }
}

export function normalizeHistoricalInterval(value) {
  const interval = String(value ?? '1d').trim().toUpperCase()
  return DAILY_INTERVALS.has(interval) ? '1day' : null
}
