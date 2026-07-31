import { buildDailyIndicatorBundle } from './buildDailyIndicatorBundle.js'
import { DEFAULT_DAILY_INDICATOR_CONFIG } from './indicatorConfig.js'

export function createDailyIndicatorPipeline({ marketDataService, logger } = {}) {
  return {
    async build({ symbol, timeframe = '1D', benchmarkSymbol = DEFAULT_DAILY_INDICATOR_CONFIG.benchmarkSymbol } = {}, options = {}) {
      const normalizedTimeframe = String(timeframe).trim().toUpperCase()
      if (!['1D', 'D', 'DAY', 'DAILY', '1DAY'].includes(normalizedTimeframe)) throw new Error('daily indicator pipeline supports only 1D')
      const symbolRequest = marketDataService.getCandles(symbol, { interval: '1d', limit: 260 })
      const sameBenchmark = symbol === benchmarkSymbol
      const benchmarkRequest = sameBenchmark ? symbolRequest : marketDataService.getCandles(benchmarkSymbol, { interval: '1d', limit: 260 })
      const statusRequest = typeof marketDataService.getMarketStatus === 'function'
        ? marketDataService.getMarketStatus()
        : Promise.resolve(null)
      const [symbolResult, benchmarkResult, statusResult] = await Promise.allSettled([symbolRequest, benchmarkRequest, statusRequest])
      const symbolResponse = symbolResult.status === 'fulfilled' ? symbolResult.value : { ok: false, provider: 'unknown' }
      const benchmarkResponse = benchmarkResult.status === 'fulfilled' ? benchmarkResult.value : { ok: false, provider: 'unknown' }
      const marketStatus = statusResult.status === 'fulfilled' ? statusResult.value : null
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
        marketOpen: options.marketOpen ?? marketStatus?.data?.isOpen ?? false,
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
