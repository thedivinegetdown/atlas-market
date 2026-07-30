const INPUT_ALIASES = Object.freeze({
  price: ['price', 'last', 'currentPrice'],
  shortMovingAverage: ['shortMovingAverage', 'shortMA', 'sma20'],
  mediumMovingAverage: ['mediumMovingAverage', 'mediumMA', 'sma50'],
  longMovingAverage: ['longMovingAverage', 'longMA', 'sma200'],
  movingAverageSlopePct: ['movingAverageSlopePct', 'maSlopePct', 'movingAverageSlope'],
  adx: ['adx'], atrPct: ['atrPct', 'normalizedAtr', 'normalizedAtrPct'], atrPercentile: ['atrPercentile'],
  rsi: ['rsi'], relativeVolume: ['relativeVolume', 'volumeRatio'], marketBreadthPct: ['marketBreadthPct', 'marketBreadth'],
  volatilityIndex: ['volatilityIndex', 'vix'], benchmarkChangePct: ['benchmarkChangePct', 'benchmarkTrendPct'],
  benchmarkAboveLongAverage: ['benchmarkAboveLongAverage'], relativeStrengthPct: ['relativeStrengthPct', 'relativeStrength'],
})

export const CONFIDENCE_INPUTS = Object.freeze(['price', 'shortMovingAverage', 'longMovingAverage', 'atrPercentile', 'marketBreadthPct', 'volatilityIndex'])

const RANGES = Object.freeze({
  price: [0, Infinity], shortMovingAverage: [0, Infinity], mediumMovingAverage: [0, Infinity], longMovingAverage: [0, Infinity],
  adx: [0, 100], atrPct: [0, Infinity], atrPercentile: [0, 100], rsi: [0, 100], relativeVolume: [0, Infinity],
  marketBreadthPct: [0, 100], volatilityIndex: [0, Infinity],
})

function firstDefined(sources, aliases) {
  for (const source of sources) for (const alias of aliases) if (source?.[alias] !== undefined && source?.[alias] !== null && source?.[alias] !== '') return source[alias]
  return undefined
}

export function normalizeRegimeInputs(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { metrics: {}, missingInputs: [...CONFIDENCE_INPUTS], invalidInputs: ['input'] }
  const sources = [input, input.metrics, input.indicators, input.marketData, input.quote, input.benchmark]
  const metrics = {}
  const invalidInputs = []
  for (const [name, aliases] of Object.entries(INPUT_ALIASES)) {
    const raw = firstDefined(sources, aliases)
    if (raw === undefined) continue
    if (name === 'benchmarkAboveLongAverage') {
      if (typeof raw === 'boolean') metrics[name] = raw
      else invalidInputs.push(name)
      continue
    }
    const value = Number(raw)
    const range = RANGES[name]
    if (Number.isFinite(value) && (!range || (value >= range[0] && value <= range[1]))) metrics[name] = value
    else invalidInputs.push(name)
  }
  const missingInputs = CONFIDENCE_INPUTS.filter((name) => metrics[name] === undefined)
  return { metrics, missingInputs, invalidInputs }
}
