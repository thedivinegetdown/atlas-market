function finiteCandle(candle) {
  return [candle?.high, candle?.low, candle?.close].every((value) => Number.isFinite(Number(value)))
    && Number(candle.high) >= Number(candle.low)
}

function rounded(value) {
  return Number(Number(value).toFixed(2))
}

function distinctLevels(levels, tolerance = 0.0025) {
  const result = []
  for (const level of levels) {
    if (!result.some((candidate) => Math.abs(candidate.value - level.value) / level.value <= tolerance)) {
      result.push(level)
    }
  }
  return result
}

export function calculateTechnicalLevels(candles = [], {
  minimumCandles = 20,
  pivotRadius = 2,
  maxPerSide = 2,
} = {}) {
  const sample = Array.isArray(candles) ? candles.filter(finiteCandle) : []
  if (sample.length < minimumCandles) {
    return {
      status: 'INSUFFICIENT',
      support: [],
      resistance: [],
      reason: `${minimumCandles} valid daily candles are required`,
      method: 'confirmed swing pivots plus selected-window extremes',
    }
  }

  const latestClose = Number(sample.at(-1).close)
  const supportCandidates = []
  const resistanceCandidates = []
  for (let index = pivotRadius; index < sample.length - pivotRadius; index += 1) {
    const candle = sample[index]
    const neighbors = sample.slice(index - pivotRadius, index + pivotRadius + 1).filter((_, offset) => offset !== pivotRadius)
    if (neighbors.every((neighbor) => Number(candle.low) <= Number(neighbor.low))) {
      supportCandidates.push({ value: rounded(candle.low), kind: 'confirmed swing low', timestamp: candle.timestamp })
    }
    if (neighbors.every((neighbor) => Number(candle.high) >= Number(neighbor.high))) {
      resistanceCandidates.push({ value: rounded(candle.high), kind: 'confirmed swing high', timestamp: candle.timestamp })
    }
  }

  const windowLow = sample.reduce((lowest, candle) => Number(candle.low) < Number(lowest.low) ? candle : lowest)
  const windowHigh = sample.reduce((highest, candle) => Number(candle.high) > Number(highest.high) ? candle : highest)
  supportCandidates.push({ value: rounded(windowLow.low), kind: 'selected-window low', timestamp: windowLow.timestamp })
  resistanceCandidates.push({ value: rounded(windowHigh.high), kind: 'selected-window high', timestamp: windowHigh.timestamp })

  const support = distinctLevels(supportCandidates
    .filter((level) => level.value < latestClose)
    .sort((left, right) => right.value - left.value)).slice(0, maxPerSide)
  const resistance = distinctLevels(resistanceCandidates
    .filter((level) => level.value > latestClose)
    .sort((left, right) => left.value - right.value)).slice(0, maxPerSide)

  return {
    status: support.length > 0 && resistance.length > 0 ? 'AVAILABLE' : 'PARTIAL',
    support,
    resistance,
    latestClose: rounded(latestClose),
    candleCount: sample.length,
    method: `confirmed ${pivotRadius}-bar swing pivots plus selected-window extremes`,
    reason: support.length > 0 && resistance.length > 0 ? null : 'The selected window does not contain levels on both sides of the latest close',
  }
}
