import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { buildProvisionalResearch } from '../lib/research/provisionalResearch.js'
import { createProvisionalResearchService } from '../lib/research/provisionalResearchService.js'
import { createDefaultMarketDataProvider, toMarketServiceQuote } from '../lib/market/defaultMarketDataProvider.js'
import { calculateAtr, calculateSma, calculateRelativeStrength } from '../lib/market/indicators/indicatorCalculations.js'
import { buildDailyIndicatorBundle } from '../lib/market/indicators/buildDailyIndicatorBundle.js'
import { buildBreakoutMomentumSignal } from '../lib/strategies/breakout/breakoutMomentumSignal.js'
import { buildRangeMeanReversionSignal } from '../lib/strategies/range/rangeMeanReversionSignal.js'
import { buildVolatilityExpansionSignal } from '../lib/strategies/volatility/volatilityExpansionSignal.js'
import { evaluatePaperCandidates } from '../lib/opportunities/paperEvaluation/paperEvaluationEngine.js'
import { validateCanonicalEntryProvenance } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { isExitEvidenceFor } from '../lib/opportunities/paperExit/exitEvidence.js'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/paperSimulationEngine.js'
import { evaluateEdge2Activation } from '../lib/opportunities/forwardTest/edge2ActivationContract.js'
import { RESEARCH_NOW, researchResponse } from './helpers/provisionalResearchFixtures.js'

function build(response = researchResponse(), benchmarkResponse = researchResponse('SPY'), now = RESEARCH_NOW) {
  return buildProvisionalResearch({ symbol: 'AAPL', historyResponse: response, benchmarkResponse, now })
}
describe('isolated provisional observation contract', () => {
  it.each(['2026-10-20T13:41:00Z', RESEARCH_NOW, '2026-10-20T20:05:00Z', '2026-10-21T00:30:00Z'])('excludes current date even with completed:true at %s', (now) => {
    const source = researchResponse(); source.receivedAt = now
    const result = build(source, source, now)
    expect(result.history.inputCutoff).toBe('2026-10-19')
    expect(result.estimates.inputCutoff).toBe(result.history.inputCutoff)
    expect(result.completion.status).toBe('UNKNOWN')
    expect(result.authoritativeCompletedSessionCutoff).toBeNull()
    expect(result.history.candles.some(bar => bar.sessionDate === '2026-10-20')).toBe(false)
  })
  it.each(['2026-10-24T17:14:00Z', '2026-11-26T17:14:00Z', '2026-11-27T20:00:00Z'])('does not infer weekend, holiday or early-close finality: %s', (now) => {
    const result = build(undefined, undefined, now)
    expect(result.history.candles.length).toBe(260)
    expect(result.completion.status).toBe('UNKNOWN')
    expect(result.revisionUncertainty).toMatch(/calendar completeness/)
  })
  it('uses exchange timezone independently of host timezone', () => {
    const moduleUrl = pathToFileURL(resolve('tests/helpers/provisionalResearchFixtures.js')).href
    const script = `import { researchOverview } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(researchOverview()));`
    const results = ['UTC', 'America/New_York'].map(TZ => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }))
    expect(results[0]).toBe(results[1])
  })
  it.each(['symbol', 'exchange', 'mic', 'timezone', 'interval'])('withholds estimates without instrument %s', (field) => {
    const response = researchResponse(); delete response.researchSource.instrument[field]
    expect(build(response).history.candles).toEqual([])
    expect(build(response).sufficiency.available).toEqual([])
  })
  it.each([{ exchange: 'UNKNOWN' }, { timezone: 'Europe/London' }, { symbol: 'MSFT' }, { mic: 'UNKNOWN' }])('withholds inconsistent metadata %j', (metadata) => {
    const response = researchResponse(); Object.assign(response.researchSource.instrument, metadata)
    expect(build(response).history.reason).toMatch(/identity/)
  })
  it.each(['not-a-timestamp', '2026-10-20T17:15:00.000Z'])('withholds estimates for invalid retrieval evidence: %s', (receivedAt) => {
    const response = researchResponse(); response.receivedAt = receivedAt
    const result = build(response)
    expect(result.history.candles).toEqual([])
    expect(result.sufficiency.available).toEqual([])
    expect(result.history.reason).toMatch(/retrieval/)
  })
  it('accepts provider-owned AAPL segment MIC without treating it as the NASDAQ operating MIC', () => {
    const result = build()
    expect(result.history.instrument).toMatchObject({ symbol: 'AAPL', exchange: 'NASDAQ', mic: 'XNGS', timezone: 'America/New_York', interval: '1day' })
    expect(result.history.candles).toHaveLength(259)
    expect(result.history.inputCutoff).toBe('2026-10-19')
    expect(result.estimates.inputCutoff).toBe(result.history.inputCutoff)
    expect(result.sufficiency.available).toEqual(expect.arrayContaining(['shortMovingAverage', 'mediumMovingAverage', 'longMovingAverage', 'atr', 'atrPct', 'relativeStrengthPct']))
    expect(result.completion.status).toBe('UNKNOWN')
    expect(result.authoritativeCompletedSessionCutoff).toBeNull()
  })
  it('excludes contradictory, invalid, missing and duplicate labels without inventing replacements', () => {
    const response = researchResponse(); const bars = response.researchSource.observations
    bars[0].complete = false; bars[1].providerDateLabel = null; bars[2].providerDateLabel = '2026-02-30'; bars[3].providerDateLabel += 'T00:00:00Z'
    bars.push({ ...bars[4], close: bars[4].close + 1 })
    const result = build(response)
    expect(result.history.candles).toHaveLength(254)
    expect(result.history.rejected.map(x => x.reason)).toContain('explicitly_incomplete')
    expect(result.revisionUncertainty).toMatch(/revisable/)
  })
  it('preserves arithmetic and minimum observations without declaring completed sessions', () => {
    const result = build(); const bars = result.history.candles
    expect(result.estimates.values.shortMovingAverage).toBe(calculateSma(bars.map(x => x.close), 20))
    expect(result.estimates.values.atr).toBe(calculateAtr(bars).value)
    expect(result.estimates.values.relativeStrengthPct).toBe(calculateRelativeStrength(bars, bars))
    const small = build(researchResponse('AAPL', 15))
    expect(small.estimates.values.atr).toBeNull()
    expect(small.estimates.values.longMovingAverage).toBeNull()
  })
  it('requires benchmark alignment through the symbol cutoff', () => {
    const benchmark = researchResponse('SPY'); benchmark.researchSource.observations.splice(-2)
    const result = build(undefined, benchmark)
    expect(result.estimates.values.relativeStrengthPct).toBeNull()
    expect(result.estimates.values.shortMovingAverage).not.toBeNull()
  })
  it('does not mutate cache objects and revisions recalculate estimates', () => {
    const response = researchResponse(); const before = JSON.stringify(response)
    const first = build(response)
    expect(JSON.stringify(response)).toBe(before)
    expect(Object.isFrozen(first.history.candles[0])).toBe(true)
    const corrected = structuredClone(response); corrected.researchSource.observations.at(-2).close += 0.5
    expect(build(corrected).estimates.values.shortMovingAverage).not.toBe(first.estimates.values.shortMovingAverage)
  })
  it('isolates malformed metadata objects and excludes ambiguous completion flags', () => {
    const response = researchResponse()
    response.researchSource.instrument.exchange = { invalid: true }
    expect(build(response).history.candles).toEqual([])
    expect(Object.isFrozen(response.researchSource.instrument.exchange)).toBe(false)
    const ambiguous = researchResponse()
    ambiguous.researchSource.observations[0].completed = 'false'
    ambiguous.researchSource.observations[1].complete = 0
    expect(build(ambiguous).history.candles).toHaveLength(257)
    expect(build(ambiguous).history.rejected.filter(item => item.reason === 'ambiguous_completion_flag')).toHaveLength(2)
  })
  it('avoids further acquisition after visible quote limiting or unusable symbol history', async () => {
    const marketDataService = { getQuote: vi.fn(async () => ({ marketDataIssue: { classification: 'RATE_LIMITED', code: 'provider_rate_limited', provider: 'twelvedata' } })), getCandles: vi.fn(async () => researchResponse('AAPL', 10)) }
    const service = createProvisionalResearchService({ marketDataService, clock: () => RESEARCH_NOW })
    await service.read('AAPL'); expect(marketDataService.getCandles).not.toHaveBeenCalled()
    await service.read('AAPL', { skipQuote: true }); expect(marketDataService.getCandles).toHaveBeenCalledTimes(1)
  })
  it.each([429, 200])('stops a direct Research acquisition after a real adapter quote-limit response (HTTP %s)', async (status) => {
    const paths = []
    const fetchImpl = vi.fn(async url => {
      paths.push(new URL(url).pathname)
      return { ok: status === 200, status, headers: { get: () => null }, json: async () => ({ code: 429, status: 'error', message: 'API credits exceeded' }) }
    })
    const provider = createDefaultMarketDataProvider({ twelveDataApiKey: 'fixture-only', fetchImpl, logger: { info: vi.fn(), warn: vi.fn() } })
    const service = createProvisionalResearchService({ marketDataService: {
      getQuote: async symbol => toMarketServiceQuote(await provider.getQuote(symbol), symbol),
      getCandles: (symbol, options) => provider.getCandles(symbol, options),
    }, clock: () => RESEARCH_NOW })
    const result = await service.read('AAPL')
    expect(paths).toEqual(['/quote'])
    expect(result.quote.provenance.dataStatus).toBe('MOCK')
    expect(result.quote.provenance.sourceObservedAt).toBeNull()
    expect(result.quote.marketDataIssue).toMatchObject({ provider: 'twelvedata', classification: 'RATE_LIMITED', code: 'provider_rate_limited', httpStatus: status })
    expect(result.provisionalResearch.history.providerError).toBe('provider_rate_limited')
    expect(result.provisionalResearch.history.candles).toEqual([])
    expect(result.provisionalResearch.sufficiency.available).toEqual([])
    expect(JSON.stringify(result)).not.toContain('fixture-only')
    expect(JSON.stringify(result)).not.toContain('API credits exceeded')
  })
  it('retains usable quote independently of unavailable history and skips acquisition for reused quotes', async () => {
    const quote = { symbol: 'AAPL', provenance: { dataStatus: 'LIVE' } }
    const marketDataService = { getQuote: vi.fn(async () => quote), getCandles: vi.fn(async () => ({ ok: false, statusCode: 429, error: { code: 'provider_rate_limited' } })) }
    const service = createProvisionalResearchService({ marketDataService, clock: () => RESEARCH_NOW })
    const result = await service.read('AAPL')
    expect(result.quote).toBe(quote); expect(result.provisionalResearch.history.providerError).toBe('provider_rate_limited')
    expect(marketDataService.getCandles).toHaveBeenCalledTimes(1)
    await service.read('AAPL', { skipQuote: true }); expect(marketDataService.getQuote).toHaveBeenCalledTimes(1)
  })
  it('acquires symbol then benchmark once and reuses SPY as its own benchmark', async () => {
    const marketDataService = { getCandles: vi.fn(async symbol => researchResponse(symbol)) }
    const service = createProvisionalResearchService({ marketDataService, clock: () => RESEARCH_NOW })
    await service.read('AAPL', { skipQuote: true })
    expect(marketDataService.getCandles.mock.calls.map(x => x[0])).toEqual(['AAPL', 'SPY'])
    marketDataService.getCandles.mockClear(); await service.read('SPY', { skipQuote: true })
    expect(marketDataService.getCandles).toHaveBeenCalledTimes(1)
  })
  it('preserves provider metadata and raw completion contradictions across existing cache hits without changing canonical candles', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ meta: { symbol: 'AAPL', exchange: 'NASDAQ', mic_code: 'XNGS', exchange_timezone: 'America/New_York', interval: '1day' }, values: [{ datetime: '2026-10-19', open: 10, high: 12, low: 9, close: 11, volume: 100, completed: true, complete: false }] }) }))
    const provider = createDefaultMarketDataProvider({ twelveDataApiKey: 'fixture', fetchImpl, logger: { info: vi.fn(), warn: vi.fn() } })
    const first = await provider.getCandles('AAPL'); const second = await provider.getCandles('AAPL')
    expect(second.cache.state).toBe('HIT'); expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(first.researchSource.observations[0]).toMatchObject({ completed: true, complete: false })
    expect(first.data[0].completed).toBe(true)
    expect(buildDailyIndicatorBundle({ symbol: 'AAPL', candles: first.data }).indicators).toEqual({})
  })
  it('cannot promote estimates through unchanged Scanner, PAPER, ledger or PA.4 gates', () => {
    const provisional = build(); const candles = provisional.history.candles.map(bar => ({ ...bar, completed: true }))
    const bundle = buildDailyIndicatorBundle({ symbol: 'AAPL', candles, benchmarkCandles: candles }, { now: RESEARCH_NOW, includeHistory: true })
    expect(bundle.indicators).toEqual({}); expect(bundle.history.candles).toEqual([])
    for (const builder of [buildBreakoutMomentumSignal, buildRangeMeanReversionSignal, buildVolatilityExpansionSignal]) {
      const signal = builder({ symbol: 'AAPL', candles, indicatorBundle: { indicators: provisional.estimates.values }, generatedAt: RESEARCH_NOW })
      expect(signal.suitabilityStatus).toBe('INSUFFICIENT_DATA')
    }
    expect(evaluatePaperCandidates({ candidates: [{ ...provisional, opportunityId: 'wrapped', strategyId: 'breakout-momentum-v1', score: 100 }] }, { now: RESEARCH_NOW })[0].status).toBe('INSUFFICIENT_DATA')
    expect(validateCanonicalEntryProvenance(provisional).valid).toBe(false)
    expect(isExitEvidenceFor(provisional, {})).toBe(false)
    expect(evaluateEdge2Activation(provisional).collectionAllowed).toBe(false)
    const forged = { ...provisional, status: 'APPROVED_FOR_PAPER_REVIEW', evaluatedAt: RESEARCH_NOW, freshness: 'FRESH', currentMarketEvidence: provisional, orderContext: { price: 100 } }
    const simulation = simulateApprovedPaperEvaluations({ enabled: true, evaluations: [forged] }, { now: RESEARCH_NOW })
    expect(simulation.results[0].status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE')
    expect(simulation.results[0].canonicalLedgerOutcome.status).toBe('NOT_COMMITTED')
  })
})
