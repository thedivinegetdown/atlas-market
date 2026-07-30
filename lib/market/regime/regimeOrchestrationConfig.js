export const REGIME_FRESHNESS = Object.freeze({
  FRESH: 'FRESH',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
})

export const DEFAULT_REGIME_ORCHESTRATION_CONFIG = Object.freeze({
  targetTimeframe: '1D',
  dailyMaxAgeMs: 36 * 60 * 60 * 1000,
  realtimeMaxAgeMs: 5 * 60 * 1000,
})

export const REGIME_INPUT_NAMES = Object.freeze([
  'price', 'shortMovingAverage', 'mediumMovingAverage', 'longMovingAverage',
  'movingAverageSlopePct', 'adx', 'atrPct', 'atrPercentile', 'rsi',
  'relativeVolume', 'marketBreadthPct', 'volatilityIndex', 'benchmarkChangePct',
  'benchmarkAboveLongAverage', 'relativeStrengthPct',
])

export const REGIME_INPUT_ALIASES = Object.freeze({
  last: 'price', currentPrice: 'price', shortMA: 'shortMovingAverage', sma20: 'shortMovingAverage',
  mediumMA: 'mediumMovingAverage', sma50: 'mediumMovingAverage', longMA: 'longMovingAverage',
  sma200: 'longMovingAverage', maSlopePct: 'movingAverageSlopePct', movingAverageSlope: 'movingAverageSlopePct',
  normalizedAtr: 'atrPct', normalizedAtrPct: 'atrPct', atrRatio: 'atrPct',
  volumeRatio: 'relativeVolume', marketBreadth: 'marketBreadthPct', breadthRatio: 'marketBreadthPct',
  vix: 'volatilityIndex', benchmarkTrendPct: 'benchmarkChangePct', relativeStrength: 'relativeStrengthPct',
})
