function round(value, precision = 6) {
  return Number(Number(value).toFixed(precision))
}

export function calculateSma(values = [], window) {
  if (values.length < window || window <= 0) return null
  const sample = values.slice(-window)
  return round(sample.reduce((sum, value) => sum + value, 0) / window)
}

export function calculateSmaSeries(values = [], window) {
  if (values.length < window) return []
  let sum = values.slice(0, window).reduce((total, value) => total + value, 0)
  const result = [sum / window]
  for (let index = window; index < values.length; index += 1) {
    sum += values[index] - values[index - window]
    result.push(sum / window)
  }
  return result
}

export function calculateNormalizedSlope(values = [], lookback = 5) {
  if (values.length <= lookback) return null
  const prior = values.at(-(lookback + 1))
  const latest = values.at(-1)
  if (!Number.isFinite(prior) || prior === 0 || !Number.isFinite(latest)) return null
  return round(((latest - prior) / Math.abs(prior)) * 100)
}

export function calculateTrueRanges(candles = []) {
  const result = []
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index]
    const previousClose = candles[index - 1].close
    result.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    ))
  }
  return result
}

export function calculateWilderSeries(values = [], period = 14) {
  if (values.length < period) return []
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  const result = [current]
  for (let index = period; index < values.length; index += 1) {
    current = ((current * (period - 1)) + values[index]) / period
    result.push(current)
  }
  return result
}

export function calculateAtr(candles = [], period = 14) {
  const series = calculateWilderSeries(calculateTrueRanges(candles), period)
  return { value: series.length ? round(series.at(-1)) : null, series: series.map((value) => round(value)) }
}

export function calculatePercentileRank(values = [], latest = values.at(-1)) {
  if (!values.length || !Number.isFinite(latest)) return null
  const atOrBelow = values.filter((value) => value <= latest).length
  return round((atOrBelow / values.length) * 100, 2)
}

export function calculateRsi(candles = [], period = 14) {
  if (candles.length < period + 1) return null
  const changes = candles.slice(1).map((candle, index) => candle.close - candles[index].close)
  const gains = changes.map((change) => Math.max(0, change))
  const losses = changes.map((change) => Math.max(0, -change))
  const averageGains = calculateWilderSeries(gains, period)
  const averageLosses = calculateWilderSeries(losses, period)
  const averageGain = averageGains.at(-1)
  const averageLoss = averageLosses.at(-1)
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100
  return round(100 - (100 / (1 + (averageGain / averageLoss))))
}

export function calculateAdx(candles = [], period = 14) {
  if (candles.length < period * 2) return null
  const trueRanges = []
  const positiveDm = []
  const negativeDm = []
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index]
    const previous = candles[index - 1]
    const upMove = current.high - previous.high
    const downMove = previous.low - current.low
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)))
    positiveDm.push(upMove > downMove && upMove > 0 ? upMove : 0)
    negativeDm.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }
  const atr = calculateWilderSeries(trueRanges, period)
  const positive = calculateWilderSeries(positiveDm, period)
  const negative = calculateWilderSeries(negativeDm, period)
  const dx = atr.map((range, index) => {
    if (range === 0) return 0
    const plusDi = 100 * (positive[index] / range)
    const minusDi = 100 * (negative[index] / range)
    return plusDi + minusDi === 0 ? 0 : 100 * (Math.abs(plusDi - minusDi) / (plusDi + minusDi))
  })
  const adx = calculateWilderSeries(dx, period)
  return adx.length ? round(adx.at(-1)) : null
}

export function calculateRelativeVolume(candles = [], window = 20) {
  if (candles.length < window + 1) return null
  const average = candles.slice(-(window + 1), -1).reduce((sum, candle) => sum + candle.volume, 0) / window
  if (average <= 0) return null
  return round(candles.at(-1).volume / average)
}

export function alignCandlesByTradingDate(symbolCandles = [], benchmarkCandles = []) {
  const benchmarkByDate = new Map(benchmarkCandles.map((candle) => [candle.timestamp.slice(0, 10), candle]))
  return symbolCandles.flatMap((candle) => {
    const benchmark = benchmarkByDate.get(candle.timestamp.slice(0, 10))
    return benchmark ? [{ symbol: candle, benchmark }] : []
  })
}

export function calculateRelativeStrength(symbolCandles = [], benchmarkCandles = [], lookback = 20) {
  const aligned = alignCandlesByTradingDate(symbolCandles, benchmarkCandles)
  if (aligned.length < lookback + 1) return null
  const sample = aligned.slice(-(lookback + 1))
  const symbolPerformance = ((sample.at(-1).symbol.close / sample[0].symbol.close) - 1) * 100
  const benchmarkPerformance = ((sample.at(-1).benchmark.close / sample[0].benchmark.close) - 1) * 100
  return round(symbolPerformance - benchmarkPerformance)
}
