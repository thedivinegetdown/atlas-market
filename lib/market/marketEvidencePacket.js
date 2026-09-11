import { createMarketDataService } from './marketDataService.js'
import { createMarketRegimeOrchestrator } from './regime/marketRegimeOrchestrator.js'
import { createDailyIndicatorPipeline } from './indicators/dailyIndicatorPipeline.js'
import { serverLogger } from '../logging/logger.js'

export const MARKET_EVIDENCE_PACKET_VERSION = 'market-evidence-packet-v1'
export const GOVERNED_UNIVERSE = Object.freeze(['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'])
export const BENCHMARK_SYMBOL = 'SPY'

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

export function createMarketEvidencePacketBuilder({
  marketDataService = createMarketDataService(),
  regimeOrchestrator = createMarketRegimeOrchestrator({ logger: serverLogger }),
  indicatorPipeline = createDailyIndicatorPipeline({ marketDataService, logger: serverLogger }),
  now = () => new Date().toISOString(),
} = {}) {
  return {
    async build(universe = GOVERNED_UNIVERSE, options = {}) {
      const timestamp = now()
      const symbols = Array.from(new Set(universe.map(s => String(s).toUpperCase())))

      if (symbols.length === 0) {
        return deepFreeze({
          version: MARKET_EVIDENCE_PACKET_VERSION,
          asOf: timestamp,
          universe: [],
          symbols: {},
          benchmark: null,
          warnings: ['Empty universe provided'],
        })
      }

      // 1. Batch quotes for all symbols (5 HTTP requests)
      const quoteResults = await marketDataService.getQuotes(symbols, { assetType: 'equity' })
      const quotes = quoteResults ?? []

      // 2. Fetch historical candles for each symbol (cached 5 min, in-flight deduped)
      const candleResults = await Promise.all(
        symbols.map(symbol => marketDataService.getCandles(symbol, { interval: '1d', limit: 260 }))
      )

      // 3. Build indicators + regime for each symbol
      const symbolEvidence = {}
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i]
        const quote = quotes.find(q => q?.symbol === symbol) ?? null
        const candlesResult = candleResults[i]
        const candles = candlesResult?.ok ? candlesResult.data : []
        const candleSource = candlesResult?.provider ?? quote?.provenance?.provider ?? 'unknown'

        if (!quote || !candles.length) {
          symbolEvidence[symbol] = {
            quote: quote ?? null,
            candles: [],
            indicators: null,
            regime: null,
            provenance: {
              quote: quote?.provenance ?? null,
              candles: candlesResult?.ok ? {
                provider: candlesResult.provider,
                candleCount: candles.length,
                historyCompleteness: candlesResult.historyCompleteness,
                cache: candlesResult.cache,
              } : null,
            },
            warnings: [
              ...(!quote ? ['Quote unavailable'] : []),
              ...(!candles.length ? ['Historical candles unavailable'] : []),
            ],
          }
          continue
        }

        // Build indicators (uses SPY candles as benchmark when symbol === SPY)
        const indicatorBundle = await indicatorPipeline.build({
          symbol,
          timeframe: '1D',
          candles,
          benchmarkSymbol: BENCHMARK_SYMBOL,
          benchmarkCandles: symbol === BENCHMARK_SYMBOL ? candles : [],
          marketOpen: false,
        }, { calculatedAt: timestamp, now: timestamp })

        // Classify regime
        const regime = regimeOrchestrator.classify({
          symbol,
          timeframe: '1D',
          marketData: quote.provenance,
          indicatorBundle,
          observations: {
            price: {
              value: quote.price,
              source: quote.provenance?.provider ?? quote.provider,
              symbol: quote.symbol,
              timeframe: 'REALTIME',
              observedAt: quote.updatedAt,
              receivedAt: timestamp,
              derivation: 'provider-supplied',
            },
          },
        }, { now: timestamp })

        symbolEvidence[symbol] = deepFreeze({
          quote: deepFreeze({
            ...quote,
            provenance: quote.provenance,
          }),
          candles: deepFreeze(candles.map(c => ({ ...c }))),
          indicators: deepFreeze(indicatorBundle.indicators ?? {}),
          indicatorCoverage: deepFreeze(indicatorBundle.coverage ?? {}),
          indicatorProvenance: deepFreeze(indicatorBundle.provenance ?? {}),
          regime: deepFreeze({
            classification: regime.classification,
            inputCoverage: regime.inputCoverage,
            engineVersion: regime.engineVersion,
            freshness: regime.freshness,
          }),
          provenance: deepFreeze({
            quote: quote.provenance,
            candles: {
              provider: candleSource,
              candleCount: candles.length,
              historyCompleteness: candlesResult.historyCompleteness,
              cache: candlesResult.cache,
            },
            indicators: {
              provider: indicatorBundle.provenance?.source ?? 'calculated',
              pipelineVersion: indicatorBundle.pipelineVersion,
            },
            regime: {
              engineVersion: regime.engineVersion,
            },
          }),
          warnings: [...(indicatorBundle.warnings ?? []), ...(regime.warnings ?? [])],
        })
      }

      // 4. Benchmark evidence (reuse SPY if available)
      const spyEvidence = symbolEvidence[BENCHMARK_SYMBOL]
      const benchmark = spyEvidence ? deepFreeze({
        symbol: BENCHMARK_SYMBOL,
        quote: spyEvidence.quote,
        candles: spyEvidence.candles,
        indicators: spyEvidence.indicators,
        indicatorCoverage: spyEvidence.indicatorCoverage,
        indicatorProvenance: spyEvidence.indicatorProvenance,
        regime: spyEvidence.regime,
        provenance: spyEvidence.provenance,
        reused: true,
      }) : null

      return deepFreeze({
        version: MARKET_EVIDENCE_PACKET_VERSION,
        asOf: timestamp,
        universe: symbols,
        symbols: symbolEvidence,
        benchmark,
        providerCalls: {
          quotes: symbols.length,
          historical: symbols.filter(s => symbolEvidence[s]?.candles?.length).length,
          benchmark: 0,
        },
      })
    },
  }
}

export const marketEvidencePacketBuilder = createMarketEvidencePacketBuilder()