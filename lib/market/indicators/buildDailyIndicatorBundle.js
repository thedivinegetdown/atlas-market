import { createDailyIndicatorConfig, DAILY_INDICATOR_PIPELINE_VERSION } from './indicatorConfig.js'
import { normalizeDailyCandles } from './normalizeDailyCandles.js'
import {
  calculateAdx, calculateAtr, calculateNormalizedSlope, calculatePercentileRank,
  calculateRelativeStrength, calculateRelativeVolume, calculateRsi, calculateSma,
  calculateSmaSeries,
} from './indicatorCalculations.js'

const INDICATORS = [
  'price', 'shortMovingAverage', 'mediumMovingAverage', 'longMovingAverage',
  'movingAverageSlopePct', 'mediumMovingAverageSlopePct', 'adx', 'atr',
  'atrPct', 'atrPercentile', 'rsi', 'relativeVolume', 'benchmarkChangePct',
  'benchmarkAboveLongAverage', 'relativeStrengthPct',
]

function addIndicator(bundle, name, value, metadata) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) && typeof value !== 'boolean') return
  bundle.indicators[name] = value
  bundle.coverage.available.push(name)
  bundle.provenance[name] = metadata
}

function provenance({ source, symbol, benchmark, asOf, calculation, window, count, calculatedAt }) {
  const observedAt = (() => {
    const parsed = Date.parse(asOf)
    const calculated = Date.parse(calculatedAt)
    if (!Number.isFinite(parsed) || !Number.isFinite(calculated)) return asOf
    const isDateOnlyMidnight = new Date(parsed).toISOString().endsWith('T00:00:00.000Z')
    if (!isDateOnlyMidnight) return asOf
    return new Date(Math.min(parsed + 86400000 - 1, calculated)).toISOString()
  })()
  return {
    source, symbol, ...(benchmark ? { benchmark } : {}), timeframe: '1D',
    observedAt, calculatedAt, derivation: 'calculated',
    calculation, window, sourceCandleCount: count,
  }
}

export function buildDailyIndicatorBundle(input = {}, options = {}) {
  const config = createDailyIndicatorConfig(options.config)
  const calculatedAt = new Date(options.calculatedAt ?? input.calculatedAt ?? new Date()).toISOString()
  const normalized = normalizeDailyCandles(input.candles, {
    symbol: input.symbol, source: input.source, now: options.now ?? calculatedAt, marketOpen: input.marketOpen,
  })
  const benchmarkNormalized = normalizeDailyCandles(input.benchmarkCandles, {
    symbol: input.benchmarkSymbol ?? config.benchmarkSymbol,
    source: input.benchmarkSource ?? input.source,
    now: options.now ?? calculatedAt,
    marketOpen: input.marketOpen,
  })
  const candles = normalized.candles
  const benchmarkCandles = input.symbol === (input.benchmarkSymbol ?? config.benchmarkSymbol) && benchmarkNormalized.candles.length === 0
    ? candles
    : benchmarkNormalized.candles
  const closes = candles.map((candle) => candle.close)
  const bundle = {
    symbol: String(input.symbol ?? '').toUpperCase(),
    timeframe: '1D',
    asOf: candles.at(-1)?.timestamp ?? null,
    indicators: {},
    coverage: { available: [], missing: [], invalid: normalized.invalid },
    provenance: {},
    warnings: [...normalized.warnings, ...benchmarkNormalized.warnings],
    pipelineVersion: DAILY_INDICATOR_PIPELINE_VERSION,
    paperTrading: true,
    advisoryOnly: true,
  }
  const base = { source: candles.at(-1)?.source ?? input.source ?? 'unknown', symbol: bundle.symbol, asOf: bundle.asOf, count: candles.length, calculatedAt }
  addIndicator(bundle, 'price', candles.at(-1)?.close, provenance({ ...base, calculation: 'latest-completed-close', window: 1 }))
  addIndicator(bundle, 'shortMovingAverage', calculateSma(closes, config.shortSmaWindow), provenance({ ...base, calculation: 'simple-moving-average', window: config.shortSmaWindow }))
  addIndicator(bundle, 'mediumMovingAverage', calculateSma(closes, config.mediumSmaWindow), provenance({ ...base, calculation: 'simple-moving-average', window: config.mediumSmaWindow }))
  addIndicator(bundle, 'longMovingAverage', calculateSma(closes, config.longSmaWindow), provenance({ ...base, calculation: 'simple-moving-average', window: config.longSmaWindow }))
  addIndicator(bundle, 'movingAverageSlopePct', calculateNormalizedSlope(calculateSmaSeries(closes, config.shortSmaWindow), config.slopeLookback), provenance({ ...base, calculation: 'normalized-sma-slope-percent', window: `${config.shortSmaWindow}+${config.slopeLookback}` }))
  addIndicator(bundle, 'mediumMovingAverageSlopePct', calculateNormalizedSlope(calculateSmaSeries(closes, config.mediumSmaWindow), config.slopeLookback), provenance({ ...base, calculation: 'normalized-sma-slope-percent', window: `${config.mediumSmaWindow}+${config.slopeLookback}` }))
  const atr = calculateAtr(candles, config.atrPeriod)
  addIndicator(bundle, 'atr', atr.value, provenance({ ...base, calculation: 'wilder-average-true-range', window: config.atrPeriod }))
  addIndicator(bundle, 'atrPct', atr.value && candles.at(-1)?.close ? (atr.value / candles.at(-1).close) * 100 : null, provenance({ ...base, calculation: 'atr-percent-of-close', window: config.atrPeriod }))
  const percentileSample = atr.series.slice(-config.atrPercentileSamples)
  addIndicator(bundle, 'atrPercentile', percentileSample.length >= config.atrPercentileSamples ? calculatePercentileRank(percentileSample) : null, provenance({ ...base, calculation: 'atr-percentile-rank', window: config.atrPercentileSamples }))
  addIndicator(bundle, 'adx', calculateAdx(candles, config.adxPeriod), provenance({ ...base, calculation: 'wilder-adx', window: config.adxPeriod }))
  addIndicator(bundle, 'rsi', calculateRsi(candles, config.rsiPeriod), provenance({ ...base, calculation: 'wilder-rsi', window: config.rsiPeriod }))
  addIndicator(bundle, 'relativeVolume', calculateRelativeVolume(candles, config.relativeVolumeWindow), provenance({ ...base, calculation: 'latest-volume-over-prior-average', window: config.relativeVolumeWindow }))

  const benchmarkSymbol = input.benchmarkSymbol ?? config.benchmarkSymbol
  const benchmarkCloses = benchmarkCandles.map((candle) => candle.close)
  const benchmarkLong = calculateSma(benchmarkCloses, config.longSmaWindow)
  const benchmarkAsOf = benchmarkCandles.at(-1)?.timestamp ?? null
  const benchmarkBase = { source: benchmarkCandles.at(-1)?.source ?? input.benchmarkSource ?? 'unknown', symbol: bundle.symbol, benchmark: benchmarkSymbol, asOf: benchmarkAsOf, count: benchmarkCandles.length, calculatedAt }
  addIndicator(bundle, 'benchmarkAboveLongAverage', benchmarkLong === null ? null : benchmarkCandles.at(-1).close > benchmarkLong, provenance({ ...benchmarkBase, calculation: 'benchmark-close-above-sma', window: config.longSmaWindow }))
  addIndicator(bundle, 'benchmarkChangePct', calculateNormalizedSlope(benchmarkCloses, config.relativeStrengthLookback), provenance({ ...benchmarkBase, calculation: 'benchmark-lookback-return-percent', window: config.relativeStrengthLookback }))
  addIndicator(bundle, 'relativeStrengthPct', calculateRelativeStrength(candles, benchmarkCandles, config.relativeStrengthLookback), provenance({ ...benchmarkBase, calculation: 'aligned-relative-return-percent', window: config.relativeStrengthLookback }))
  bundle.coverage.missing = INDICATORS.filter((name) => !bundle.coverage.available.includes(name))
  if (!benchmarkCandles.length) bundle.warnings.push(`Benchmark ${benchmarkSymbol} history is unavailable`)
  if (candles.length < config.longSmaWindow) bundle.warnings.push(`Only ${candles.length} completed daily candles are available; SMA ${config.longSmaWindow} requires ${config.longSmaWindow}`)
  return bundle
}
