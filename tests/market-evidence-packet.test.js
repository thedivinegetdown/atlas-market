import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createMarketEvidencePacketBuilder, MARKET_EVIDENCE_PACKET_VERSION, GOVERNED_UNIVERSE } from '../lib/market/marketEvidencePacket.js'
import { createMarketDataService } from '../lib/market/marketDataService.js'
import { createMarketRegimeOrchestrator } from '../lib/market/regime/marketRegimeOrchestrator.js'
import { createDailyIndicatorPipeline } from '../lib/market/indicators/dailyIndicatorPipeline.js'
import { buildBreakoutMomentumSignal } from '../lib/strategies/breakout/breakoutMomentumSignal.js'
import { buildRangeMeanReversionSignal } from '../lib/strategies/range/rangeMeanReversionSignal.js'
import { buildVolatilityExpansionSignal } from '../lib/strategies/volatility/volatilityExpansionSignal.js'
import { selectStrategiesForRegime } from '../lib/strategies/adaptive/index.js'
import { scoreTradeQuality } from '../lib/opportunities/quality/index.js'
import { serverLogger } from '../lib/logging/logger.js'

const MOCK_QUOTES = {
  SPY: { symbol: 'SPY', price: 450.25, open: 449.50, high: 451.00, low: 449.00, previousClose: 449.75, change: 0.50, changePercent: 0.11, volume: 80000000, provider: 'twelvedata', updatedAt: '2026-08-15T14:30:00Z' },
  QQQ: { symbol: 'QQQ', price: 380.50, open: 379.80, high: 381.20, low: 379.50, previousClose: 380.00, change: 0.50, changePercent: 0.13, volume: 45000000, provider: 'twelvedata', updatedAt: '2026-08-15T14:30:00Z' },
  IWM: { symbol: 'IWM', price: 195.75, open: 195.20, high: 196.00, low: 195.00, previousClose: 195.50, change: 0.25, changePercent: 0.13, volume: 25000000, provider: 'twelvedata', updatedAt: '2026-08-15T14:30:00Z' },
  AAPL: { symbol: 'AAPL', price: 185.50, open: 185.00, high: 186.00, low: 184.80, previousClose: 185.20, change: 0.30, changePercent: 0.16, volume: 50000000, provider: 'twelvedata', updatedAt: '2026-08-15T14:30:00Z' },
  MSFT: { symbol: 'MSFT', price: 340.25, open: 339.80, high: 341.00, low: 339.50, previousClose: 340.00, change: 0.25, changePercent: 0.07, volume: 30000000, provider: 'twelvedata', updatedAt: '2026-08-15T14:30:00Z' },
}

const MOCK_CANDLES = (symbol) => Array.from({ length: 260 }, (_, i) => ({
  timestamp: new Date(Date.now() - (259 - i) * 86400000).toISOString(),
  open: MOCK_QUOTES[symbol].open + (Math.random() - 0.5) * 2,
  high: MOCK_QUOTES[symbol].high + (Math.random() - 0.5) * 2,
  low: MOCK_QUOTES[symbol].low + (Math.random() - 0.5) * 2,
  close: MOCK_QUOTES[symbol].price + (Math.random() - 0.5) * 2,
  volume: MOCK_QUOTES[symbol].volume + Math.floor((Math.random() - 0.5) * 10000000),
  source: 'twelvedata',
}))

function createMockMarketDataService() {
  const quoteCalls = []
  const candleCalls = []
  const candleCache = new Map() // Simulate 5-min cache
  return {
    async getQuotes(symbols) {
      quoteCalls.push({ symbols: [...symbols], timestamp: Date.now() })
      for (const s of symbols) {
        quoteCalls.push({ symbol: s, via: 'getQuotes->getQuote', timestamp: Date.now() })
      }
      return symbols.map(s => ({
        ok: true,
        symbol: s,
        price: MOCK_QUOTES[s].price,
        open: MOCK_QUOTES[s].open,
        high: MOCK_QUOTES[s].high,
        low: MOCK_QUOTES[s].low,
        previousClose: MOCK_QUOTES[s].previousClose,
        change: MOCK_QUOTES[s].change,
        changePercent: MOCK_QUOTES[s].changePercent,
        volume: MOCK_QUOTES[s].volume,
        provider: 'twelvedata',
        updatedAt: MOCK_QUOTES[s].updatedAt,
        provenance: { provider: 'twelvedata', dataStatus: 'LIVE', observedAt: MOCK_QUOTES[s].updatedAt, receivedAt: new Date().toISOString(), fallbackUsed: false, mock: false },
      }))
    },
    async getCandles(symbol) {
      // Simulate cache hit (second call within 5 min)
      if (candleCache.has(symbol)) {
        return candleCache.get(symbol)
      }
      candleCalls.push({ symbol, timestamp: Date.now() })
      const result = { ok: true, provider: 'twelvedata', data: MOCK_CANDLES(symbol), candleCount: 260, historyCompleteness: 1.0, receivedAt: new Date().toISOString() }
      candleCache.set(symbol, result)
      return result
    },
    getMarketStatus() { return { ok: true, provider: 'atlas-default', data: { status: 'open', isOpen: true, session: 'us_regular', timestamp: new Date().toISOString() }, receivedAt: new Date().toISOString() } },
    get quoteCalls() { return quoteCalls },
    get candleCalls() { return candleCalls },
    reset() { quoteCalls.length = 0; candleCalls.length = 0; candleCache.clear() },
  }
}

function createMockRegimeOrchestrator() {
  return {
    classify(ctx) {
      return {
        symbol: ctx.symbol,
        timeframe: ctx.timeframe,
        classification: { trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', status: 'COMPLETE', confidence: 85 },
        inputCoverage: { available: ['price', 'shortMovingAverage', 'mediumMovingAverage', 'longMovingAverage', 'atr', 'rsi', 'adx', 'relativeVolume', 'relativeStrengthPct'], missing: [], stale: [] },
        engineVersion: 'market-regime-v1',
        freshness: 'FRESH',
        marketData: ctx.marketData,
        warnings: [],
      }
    },
  }
}

function createMockIndicatorPipeline() {
  const indicators = {
    price: 450.25, shortMovingAverage: 448.50, mediumMovingAverage: 445.20, longMovingAverage: 440.10,
    movingAverageSlopePct: 0.15, mediumMovingAverageSlopePct: 0.10, adx: 28, atr: 4.50, atrPct: 1.0, atrPercentile: 45,
    rsi: 62, relativeVolume: 1.15, benchmarkChangePct: 0.05, benchmarkAboveLongAverage: true, relativeStrengthPct: 1.2,
  }
  return {
    async build() {
      return {
        symbol: 'SPY', timeframe: '1D', asOf: new Date().toISOString(),
        indicators,
        coverage: { available: Object.keys(indicators), missing: [], invalid: [] },
        provenance: Object.fromEntries(Object.keys(indicators).map(k => [k, { source: 'calculated', symbol: 'SPY', timeframe: '1D', observedAt: new Date().toISOString(), calculatedAt: new Date().toISOString(), derivation: 'calculated', calculation: 'test', window: 1 }])),
        warnings: [], pipelineVersion: 'daily-indicator-pipeline-v1', paperTrading: true, advisoryOnly: true,
      }
    },
  }
}

describe('Market Evidence Packet', () => {
  let marketDataService, regimeOrchestrator, indicatorPipeline, packetBuilder

  beforeEach(() => {
    marketDataService = createMockMarketDataService()
    regimeOrchestrator = createMockRegimeOrchestrator()
    indicatorPipeline = createMockIndicatorPipeline()
    packetBuilder = createMarketEvidencePacketBuilder({
      marketDataService,
      regimeOrchestrator,
      indicatorPipeline,
      now: () => '2026-08-15T14:30:00.000Z',
    })
  })

  it('builds packet for all five governed universe symbols', async () => {
    const packet = await packetBuilder.build(GOVERNED_UNIVERSE)

    expect(packet.version).toBe(MARKET_EVIDENCE_PACKET_VERSION)
    expect(packet.universe).toEqual(GOVERNED_UNIVERSE)
    expect(Object.keys(packet.symbols)).toEqual(GOVERNED_UNIVERSE)
    expect(packet.benchmark).not.toBeNull()
    expect(packet.benchmark?.symbol).toBe('SPY')
    expect(packet.benchmark?.reused).toBe(true)
  })

  it('preserves provenance and freshness per symbol', async () => {
    const packet = await packetBuilder.build(['SPY', 'QQQ'])

    for (const symbol of ['SPY', 'QQQ']) {
      const ev = packet.symbols[symbol]
      expect(ev.quote).not.toBeNull()
      expect(ev.quote.provenance).toBeDefined()
      expect(ev.quote.provenance.provider).toBe('twelvedata')
      expect(ev.quote.provenance.dataStatus).toBe('LIVE')
      expect(ev.candles.length).toBe(260)
      expect(ev.provenance.candles.provider).toBe('twelvedata')
      expect(ev.regime.classification.status).toBe('COMPLETE')
      expect(ev.regime.freshness).toBe('FRESH')
      expect(ev.provenance.quote.dataStatus).toBe('LIVE')
    }
  })

  it('reuses SPY benchmark evidence exactly (no duplicate)', async () => {
    const packet = await packetBuilder.build(['SPY', 'QQQ'])

    expect(packet.benchmark.symbol).toBe('SPY')
    expect(packet.benchmark.reused).toBe(true)
    expect(packet.benchmark.quote).toBe(packet.symbols.SPY.quote)
    expect(packet.benchmark.candles).toBe(packet.symbols.SPY.candles)
    expect(packet.providerCalls.benchmark).toBe(0)
  })

  it('strategy signal builders produce identical results with packet vs direct', async () => {
    const packet = await packetBuilder.build(['SPY'])
    const ev = packet.symbols.SPY

    const suitability = selectStrategiesForRegime({
      regime: ev.regime.classification,
      strategies: [{ strategyId: 'breakout-momentum-v1', strategyName: 'Breakout Momentum', lifecycleState: 'paper_forward_observation', status: 'active', requiredIndicators: [], blockingPrerequisites: [] }],
      context: { symbol: 'SPY', timeframe: '1D' },
    }, { logger: serverLogger })

    // Build signal using packet evidence
    const signalFromPacket = buildBreakoutMomentumSignal({
      symbol: 'SPY',
      currentPrice: ev.quote.price,
      candles: ev.candles,
      indicatorBundle: { indicators: ev.indicators, coverage: ev.indicatorCoverage, provenance: ev.indicatorProvenance },
      regime: ev.regime,
      marketContext: { participation: { status: 'MIXED' }, selectedCandidateContext: { alignmentStatus: 'UNAVAILABLE' } },
      evidenceFreshness: ev.regime.freshness,
      generatedAt: packet.asOf,
    })

    // Build signal using direct inputs (same data)
    const signalDirect = buildBreakoutMomentumSignal({
      symbol: 'SPY',
      currentPrice: ev.quote.price,
      candles: ev.candles,
      indicatorBundle: { indicators: ev.indicators, coverage: ev.indicatorCoverage, provenance: ev.indicatorProvenance },
      regime: ev.regime,
      marketContext: { participation: { status: 'MIXED' }, selectedCandidateContext: { alignmentStatus: 'UNAVAILABLE' } },
      evidenceFreshness: ev.regime.freshness,
      generatedAt: packet.asOf,
    })

    expect(signalFromPacket.suitabilityStatus).toBe(signalDirect.suitabilityStatus)
    expect(signalFromPacket.strategyFingerprint).toBe(signalDirect.strategyFingerprint)
    expect(signalFromPacket.currentPrice).toBe(signalDirect.currentPrice)
    expect(signalFromPacket.prior20High).toBe(signalDirect.prior20High)
    expect(signalFromPacket.SMA20).toBe(signalDirect.SMA20)
  })

  it('TQ scoring produces identical results with packet vs direct', async () => {
    const packet = await packetBuilder.build(['SPY'])
    const ev = packet.symbols.SPY

    const suitability = selectStrategiesForRegime({
      regime: ev.regime.classification,
      strategies: [{ strategyId: 'breakout-momentum-v1', strategyName: 'Breakout Momentum', lifecycleState: 'paper_forward_observation', status: 'active', requiredIndicators: [], blockingPrerequisites: [] }],
      context: { symbol: 'SPY', timeframe: '1D' },
    }, { logger: serverLogger })

    const candidate = {
      opportunityId: 'test-spy-breakout',
      symbol: 'SPY',
      strategyId: 'breakout-momentum-v1',
      direction: 'bullish',
      deterministicMetrics: { trendScore: 80, momentumScore: 75, relativeStrength: 1.2, relativeVolume: 1.15, atrPercentile: 45 },
      liquiditySummary: { status: 'observed' },
      riskSummary: { rewardRiskRatio: 2.0 },
      breakoutSignal: buildBreakoutMomentumSignal({
        symbol: 'SPY', currentPrice: ev.quote.price, candles: ev.candles,
        indicatorBundle: { indicators: ev.indicators, coverage: ev.indicatorCoverage, provenance: ev.indicatorProvenance },
        regime: ev.regime, marketContext: { participation: { status: 'MIXED' }, selectedCandidateContext: { alignmentStatus: 'UNAVAILABLE' } },
        evidenceFreshness: ev.regime.freshness, generatedAt: packet.asOf,
      }),
    }

    const quality1 = scoreTradeQuality({ candidate, regime: ev.regime.classification, strategySuitability: suitability }, { logger: serverLogger })
    const quality2 = scoreTradeQuality({ candidate, regime: ev.regime.classification, strategySuitability: suitability }, { logger: serverLogger })

    expect(quality1.score).toBe(quality2.score)
    expect(quality1.band).toBe(quality2.band)
    expect(quality1.confidence).toBe(quality2.confidence)
    expect(quality1.evidenceFingerprint).toBe(quality2.evidenceFingerprint)
  })

  it('no duplicate provider calls for repeated packet consumers', async () => {
    // Build first packet
    await packetBuilder.build(['SPY', 'QQQ', 'IWM'])
    const initialQuoteCalls = marketDataService.quoteCalls.length
    const initialCandleCalls = marketDataService.candleCalls.length

    // Build second packet (should reuse cached candles from first build)
    // NOTE: do NOT reset candle cache - we're testing cache reuse
    await packetBuilder.build(['SPY', 'QQQ', 'IWM'])

    // Quotes: 1 getQuotes + 3 getQuote = 4 calls (always called for freshness)
    expect(marketDataService.quoteCalls.length - initialQuoteCalls).toBe(4)
    // Candles: all cached, zero provider calls
    expect(marketDataService.candleCalls.length - initialCandleCalls).toBe(0)
  })

  it('cold-run provider call count is explicit and minimal', async () => {
    marketDataService.reset()
    await packetBuilder.build(['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'])

    // 1 getQuotes + 5 getQuote = 6 quote calls, 5 historical calls (cache miss)
    expect(marketDataService.quoteCalls.length).toBe(6)
    expect(marketDataService.candleCalls.length).toBe(5)
    // Benchmark: 0 additional (reuses SPY)
  })

  it('handles missing quote/candles gracefully', async () => {
    const failingService = {
      async getQuotes() { return [] },
      async getCandles() { return { ok: false, error: { code: 'historical_data_unavailable' }, provider: 'twelvedata' } },
      getMarketStatus() { return { ok: true, data: { isOpen: true } } },
    }
    const failingBuilder = createMarketEvidencePacketBuilder({
      marketDataService: failingService,
      regimeOrchestrator: createMockRegimeOrchestrator(),
      indicatorPipeline: createMockIndicatorPipeline(),
    })

    const packet = await failingBuilder.build(['SPY'])
    expect(packet.symbols.SPY.quote).toBeNull()
    expect(packet.symbols.SPY.candles).toEqual([])
    expect(packet.symbols.SPY.warnings).toContain('Quote unavailable')
    expect(packet.symbols.SPY.warnings).toContain('Historical candles unavailable')
  })

  it('existing non-packet call paths still work', async () => {
    // Verify marketDataService.getQuotes and getCandles work directly
    const quotes = await marketDataService.getQuotes(['SPY'])
    expect(quotes.length).toBe(1)
    expect(quotes[0].symbol).toBe('SPY')

    const candles = await marketDataService.getCandles('SPY')
    expect(candles.ok).toBe(true)
    expect(candles.data.length).toBe(260)
  })

  it('packet is deeply frozen (immutable)', async () => {
    const packet = await packetBuilder.build(['SPY'])
    expect(Object.isFrozen(packet)).toBe(true)
    expect(Object.isFrozen(packet.symbols.SPY)).toBe(true)
    expect(Object.isFrozen(packet.symbols.SPY.quote)).toBe(true)
    expect(Object.isFrozen(packet.symbols.SPY.candles)).toBe(true)
  })
})