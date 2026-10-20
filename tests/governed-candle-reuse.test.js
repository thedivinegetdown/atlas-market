import { describe, expect, it, vi } from 'vitest'
import { createDailyIndicatorPipeline } from '../lib/market/indicators/dailyIndicatorPipeline.js'
import { createMarketEvidencePacketBuilder, GOVERNED_UNIVERSE } from '../lib/market/marketEvidencePacket.js'
import { normalizeHistoricalDailyCandles } from '../lib/market/historicalCandleNormalizer.js'

const AS_OF = new Date().toISOString()
const REQUEST = (symbol) => ({ symbol, interval: '1d', limit: 260, order: 'asc', adjust: 'splits' })

function result(symbol) {
  const raw = Array.from({ length: 260 }, (_, index) => {
    const close = 100 + index / 10
    return {
      timestamp: new Date(Date.parse(AS_OF) - (260 - index) * 86400000).toISOString(),
      open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 + index,
    }
  })
  const normalized = normalizeHistoricalDailyCandles(raw, { symbol, provider: 'twelvedata', minimumCount: 260 })
  return {
    ok: true, provider: 'twelvedata', data: normalized.candles, receivedAt: AS_OF,
    requestedCount: 260, candleCount: 260, historyCompleteness: 'COMPLETE', fallbackUsed: false,
  }
}

function service(results) {
  return {
    getCandles: vi.fn(async (symbol) => results[symbol]),
    getMarketStatus: vi.fn(async () => ({ ok: true, data: { isOpen: false } })),
    getQuotes: vi.fn(async (symbols) => symbols.map((symbol) => ({
      symbol, price: 125, updatedAt: AS_OF,
      provenance: { provider: 'twelvedata', dataStatus: 'LIVE', mock: false, sourceObservedAt: AS_OF, receivedAt: AS_OF },
    }))),
  }
}

const OPTIONS = { calculatedAt: AS_OF, now: AS_OF, evidenceCheckedAt: AS_OF }

describe('governed daily candle reuse', () => {
  it('reuses five acquired histories without upgrading their unqualified finality', async () => {
    const results = Object.fromEntries(GOVERNED_UNIVERSE.map(symbol => [symbol, result(symbol)]))
    const data = service(results)
    const pipeline = createDailyIndicatorPipeline({ marketDataService: data })
    const expected = {}
    for (const symbol of GOVERNED_UNIVERSE) {
      expected[symbol] = await pipeline.build({ symbol, benchmarkSymbol: 'SPY' }, OPTIONS)
    }
    expect(data.getCandles).toHaveBeenCalledTimes(9)
    data.getCandles.mockClear()

    const packet = await createMarketEvidencePacketBuilder({
      marketDataService: data,
      indicatorPipeline: pipeline,
      creditBudget: { waitForCapacity: vi.fn() },
      regimeOrchestrator: { classify: () => ({ classification: { status: 'COMPLETE' }, inputCoverage: {}, engineVersion: 'test', freshness: 'FRESH', warnings: [] }) },
      now: () => AS_OF,
    }).build(GOVERNED_UNIVERSE)

    expect(data.getCandles).toHaveBeenCalledTimes(5)
    expect(data.getCandles.mock.calls.map(call => call[0])).toEqual(GOVERNED_UNIVERSE)
    expect(packet.providerCalls.credits).toBe(10)
    for (const symbol of GOVERNED_UNIVERSE) {
      expect(packet.symbols[symbol].indicators).toEqual(expected[symbol].indicators)
      expect(packet.symbols[symbol].indicatorCoverage).toEqual(expected[symbol].coverage)
      expect(packet.symbols[symbol].indicatorProvenance).toEqual(expected[symbol].provenance)
      expect(packet.symbols[symbol].candles).toEqual(results[symbol].data)
      expect(packet.symbols[symbol].provenance.candles.provider).toBe('twelvedata')
    }
    expect(packet.symbols.QQQ.indicatorCoverage.missing).toContain('relativeStrengthPct')
    expect(packet.symbols.QQQ.indicatorCoverage.completion.status).toBe('UNKNOWN')
    expect(packet.symbols.QQQ.indicators).toEqual({})
    expect(Object.keys(packet.symbols)).toEqual(GOVERNED_UNIVERSE)
  })

  it('fetches independently when the requested interval, adjustment, or identity differs', async () => {
    const results = { SPY: result('SPY'), QQQ: result('QQQ') }
    const data = service(results)
    const pipeline = createDailyIndicatorPipeline({ marketDataService: data })
    for (const request of [{ ...REQUEST('QQQ'), interval: '1h' }, { ...REQUEST('QQQ'), adjust: 'none' }, REQUEST('IWM')]) {
      data.getCandles.mockClear()
      await pipeline.build({ symbol: 'QQQ', benchmarkSymbol: 'SPY',
        candleEvidence: { request, result: results.QQQ },
        benchmarkCandleEvidence: { request: REQUEST('SPY'), result: results.SPY },
      }, OPTIONS)
      expect(data.getCandles).toHaveBeenCalledTimes(1)
      expect(data.getCandles).toHaveBeenCalledWith('QQQ', { interval: '1d', limit: 260 })
    }
  })

  it('does not upgrade unavailable SPY benchmark or malformed and stale packet histories', async () => {
    const valid = result('QQQ')
    const failedSpy = { ok: false, provider: 'atlas-default', error: { code: 'provider_rate_limited' } }
    const data = service({ SPY: result('SPY'), QQQ: valid })
    const pipeline = createDailyIndicatorPipeline({ marketDataService: data })
    const bundle = await pipeline.build({ symbol: 'QQQ', benchmarkSymbol: 'SPY',
      candleEvidence: { request: REQUEST('QQQ'), result: valid },
      benchmarkCandleEvidence: { request: REQUEST('SPY'), result: failedSpy },
    }, OPTIONS)
    expect(data.getCandles).not.toHaveBeenCalled()
    expect(bundle.coverage.missing).toContain('relativeStrengthPct')
    expect(bundle.warnings).toContain('Benchmark SPY provider is unavailable')

    for (const invalid of [
      { ...valid, data: valid.data.map((candle, index) => index === 0 ? { ...candle, symbol: 'SPY' } : candle) },
      { ...valid, receivedAt: new Date(Date.parse(AS_OF) - 3600000).toISOString() },
      { ...valid, mock: true },
      { ...valid, data: valid.data.map((candle, index) => index === 0 ? { ...candle, close: NaN } : candle) },
    ]) {
      data.getCandles.mockClear()
      const degraded = await pipeline.build({ symbol: 'QQQ', benchmarkSymbol: 'SPY',
        candleEvidence: { request: REQUEST('QQQ'), result: invalid },
        benchmarkCandleEvidence: { request: REQUEST('SPY'), result: failedSpy },
      }, OPTIONS)
      expect(data.getCandles).not.toHaveBeenCalled()
      expect(degraded.coverage.missing).toContain('price')
    }
  })
})
