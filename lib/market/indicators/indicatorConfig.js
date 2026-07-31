export const DAILY_INDICATOR_PIPELINE_VERSION = 'daily-indicators-v1'

export const DEFAULT_DAILY_INDICATOR_CONFIG = Object.freeze({
  timeframe: '1D',
  benchmarkSymbol: 'SPY',
  shortSmaWindow: 20,
  mediumSmaWindow: 50,
  longSmaWindow: 200,
  slopeLookback: 5,
  atrPeriod: 14,
  atrPercentileSamples: 100,
  adxPeriod: 14,
  rsiPeriod: 14,
  relativeVolumeWindow: 20,
  relativeStrengthLookback: 20,
})

export function createDailyIndicatorConfig(overrides = {}) {
  return { ...DEFAULT_DAILY_INDICATOR_CONFIG, ...overrides }
}
