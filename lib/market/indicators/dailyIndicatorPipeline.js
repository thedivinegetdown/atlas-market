import { buildDailyIndicatorBundle } from './buildDailyIndicatorBundle.js'
import { DEFAULT_DAILY_INDICATOR_CONFIG } from './indicatorConfig.js'

const DAILY_HISTORY_REQUEST = Object.freeze({ interval: '1d', limit: 260, order: 'asc', adjust: 'splits' })

function packetDailyHistory(evidence, symbol, now) {
  if (!evidence || evidence.request?.symbol !== symbol
    || evidence.request?.interval !== DAILY_HISTORY_REQUEST.interval
    || evidence.request?.limit !== DAILY_HISTORY_REQUEST.limit
    || evidence.request?.order !== DAILY_HISTORY_REQUEST.order
    || evidence.request?.adjust !== DAILY_HISTORY_REQUEST.adjust) return null

  const result = evidence.result
  // A failed acquisition is still the packet's authoritative attempt. Refetching it
  // here could silently upgrade a degraded governed observation.
  if (result?.ok !== true) return result ?? { ok: false, provider: 'unknown' }
  if (result.fallbackUsed === true || result.mock === true
    || !result.provider || ['unknown', 'mock'].includes(result.provider)
    || result.requestedCount !== DAILY_HISTORY_REQUEST.limit
    || !Array.isArray(result.data) || result.data.length === 0
    || result.data.length > DAILY_HISTORY_REQUEST.limit
    || result.candleCount !== result.data.length
    || result.historyCompleteness !== (result.data.length === DAILY_HISTORY_REQUEST.limit ? 'COMPLETE' : 'TRUNCATED')) {
    return { ok: false, provider: result.provider ?? 'unknown' }
  }
  const receivedAt = Date.parse(result.receivedAt)
  const evaluatedAt = Date.parse(now)
  if (!Number.isFinite(receivedAt) || !Number.isFinite(evaluatedAt)
    || receivedAt > evaluatedAt || evaluatedAt - receivedAt > 5 * 60 * 1000) {
    return { ok: false, provider: result.provider }
  }
  let previous = -Infinity
  for (const candle of result.data) {
    const timestamp = Date.parse(candle?.timestamp)
    if (candle?.symbol !== symbol || candle.interval !== '1d'
      || candle.provider !== result.provider || candle.source !== result.provider
      || candle.completed === false || !Number.isFinite(timestamp) || timestamp <= previous
      || ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
      || candle.open <= 0 || candle.low <= 0 || candle.close <= 0
      || candle.high < Math.max(candle.open, candle.close, candle.low)
      || candle.low > Math.min(candle.open, candle.close)
      || candle.volume < 0) return { ok: false, provider: result.provider }
    previous = timestamp
  }
  return result
}

export function createDailyIndicatorPipeline({ marketDataService, logger } = {}) {
  return {
    async build({ symbol, timeframe = '1D', benchmarkSymbol = DEFAULT_DAILY_INDICATOR_CONFIG.benchmarkSymbol,
      candleEvidence, benchmarkCandleEvidence } = {}, options = {}) {
      const normalizedTimeframe = String(timeframe).trim().toUpperCase()
      if (!['1D', 'D', 'DAY', 'DAILY', '1DAY'].includes(normalizedTimeframe)) throw new Error('daily indicator pipeline supports only 1D')
      const evidenceCheckedAt = options.evidenceCheckedAt ?? new Date().toISOString()
      const symbolHistory = packetDailyHistory(candleEvidence, symbol, evidenceCheckedAt)
      const benchmarkHistory = packetDailyHistory(benchmarkCandleEvidence, benchmarkSymbol, evidenceCheckedAt)
      const symbolRequest = symbolHistory
        ? Promise.resolve(symbolHistory)
        : marketDataService.getCandles(symbol, { interval: '1d', limit: 260 })
      const sameBenchmark = symbol === benchmarkSymbol
      const benchmarkRequest = sameBenchmark ? symbolRequest
        : benchmarkHistory
          ? Promise.resolve(benchmarkHistory)
          : marketDataService.getCandles(benchmarkSymbol, { interval: '1d', limit: 260 })
      // The market-status heuristic cannot qualify daily completion. Do not
      // translate absent/closed status into permission to include a daily bar.
      const [symbolResult, benchmarkResult] = await Promise.allSettled([symbolRequest, benchmarkRequest])
      const symbolResponse = symbolResult.status === 'fulfilled' ? symbolResult.value : { ok: false, provider: 'unknown' }
      const benchmarkResponse = benchmarkResult.status === 'fulfilled' ? benchmarkResult.value : { ok: false, provider: 'unknown' }
      const source = symbolResponse?.provider ?? 'unknown'
      const benchmarkSource = benchmarkResponse?.provider ?? 'unknown'
      const bundle = buildDailyIndicatorBundle({
        symbol,
        timeframe,
        source,
        candles: symbolResponse?.ok ? symbolResponse.data : [],
        benchmarkSymbol,
        benchmarkSource,
        benchmarkCandles: benchmarkResponse?.ok ? benchmarkResponse.data : [],
      }, options)
      if (!symbolResponse?.ok) bundle.warnings.push('Historical candle provider is unavailable')
      if (!benchmarkResponse?.ok) bundle.warnings.push(`Benchmark ${benchmarkSymbol} provider is unavailable`)
      bundle.warnings.push(...(symbolResponse?.warnings ?? []))
      if (!sameBenchmark) bundle.warnings.push(...(benchmarkResponse?.warnings ?? []))
      logger?.info?.('daily indicator pipeline completed', {
        symbol, timeframe, provider: source, validCandleCount: bundle.provenance.price?.sourceCandleCount ?? 0,
        missingIndicatorCount: bundle.coverage.missing.length,
        benchmarkAvailable: Boolean(bundle.provenance.benchmarkChangePct),
        pipelineVersion: bundle.pipelineVersion,
      })
      return bundle
    },
  }
}
