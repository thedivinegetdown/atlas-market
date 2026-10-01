import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFinnhubClient } from '../lib/market/finnhubClient.js'
import { createTwelveDataClient } from '../lib/market/twelveDataClient.js'
import { normalizeQuote, normalizeSourceObservationTimestamp } from '../lib/market/marketNormalizer.js'
import { normalizeQuoteResponse } from '../lib/market/providerContract.js'
import { toMarketServiceQuote } from '../lib/market/defaultMarketDataProvider.js'
import { compactCurrentMarketEvidence, validateCurrentMarketEvidence } from '../lib/market/currentMarketEvidenceContract.js'
import { evaluatePaperCandidates } from '../lib/opportunities/paperEvaluation/paperEvaluationEngine.js'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/paperSimulationEngine.js'
import { validateCanonicalEntryProvenance } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'

const NOW = '2026-10-01T15:00:00.000Z'
const OBSERVED = '2026-10-01T14:59:30.000Z'
const RECEIVED = '2026-10-01T14:59:31.000Z'
const originalFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = originalFetch })

function provenance(overrides = {}) {
  return {
    provider: 'primary-market-provider', dataStatus: 'LIVE', freshness: 'FRESH',
    fallbackUsed: false, mock: false, delayed: false,
    sourceObservedAt: OBSERVED, observedAt: OBSERVED, sourceTimestampStatus: 'VALID',
    receivedAt: RECEIVED, sourceCount: 1, warningCodes: [], ...overrides,
  }
}

function evaluation(candidateProvenance = provenance(), regimeProvenance = provenance()) {
  return evaluatePaperCandidates({
    candidates: [{ opportunityId: 'opp-aapl', symbol: 'AAPL', strategyId: 'momentum', score: 86,
      band: 'STRONG', confidence: 82, qualityStatus: 'COMPLETE', blockers: [], missingInputs: [],
      freshness: 'FRESH', asOf: OBSERVED, engineVersion: 'trade-quality-v1', marketData: candidateProvenance,
      orderContext: { assetType: 'equity', side: 'buy', orderType: 'market', price: 100,
        stopPrice: 98, targetPrice: 104, quantity: 10 } }],
    regime: { symbol: 'SPY', engineVersion: 'market-regime-v1', asOf: OBSERVED, freshness: 'FRESH',
      marketData: regimeProvenance, classification: { trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY',
        riskRegime: 'RISK_ON', status: 'COMPLETE', confidence: 84 } },
    strategySuitability: { engineVersion: 'adaptive-strategy-v1', strategies: [{ strategyId: 'momentum', decision: 'ENABLED', confidence: 82, blockingReasons: [] }] },
    portfolioRisk: { maxDrawdown: 2 }, currentMarketEvidence: { symbol: 'SPY', price: 500 },
  }, { now: NOW })[0]
}

function executionQuote(quoteProvenance = provenance({ sourceObservedAt: NOW, observedAt: NOW, receivedAt: NOW })) {
  return { symbol: 'AAPL', price: 100, bid: 99.98, ask: 100.02, bidSize: 10000, askSize: 10000,
    liquidityScore: 80, updatedAt: NOW, provenance: quoteProvenance }
}

function simulate(recommendation = evaluation(), quote = executionQuote()) {
  return simulateApprovedPaperEvaluations({
    evaluations: [recommendation],
    portfolio: { id: 'paper-portfolio', cash: 100000, equity: 100000, buyingPower: 100000, positions: [] },
    portfolioRisk: { account: { accountValue: 100000, cash: 100000, buyingPower: 100000 },
      summary: { openRisk: 0, openRiskPct: 0, drawdownPct: 0 } },
    enabled: true, executionQuotes: [quote],
  }, { now: NOW, confirmedAt: NOW, confirmationSource: 'authenticated_manual_request' }).results[0]
}

function adapterQuote(sourceTimestamp) {
  const raw = { symbol: 'AAPL', price: 100 }
  if (sourceTimestamp !== undefined) raw.updatedAt = sourceTimestamp
  return toMarketServiceQuote(normalizeQuoteResponse(raw, 'finnhub'), 'AAPL')
}

describe('Phase 2 source observation timestamp truth', () => {
  it('qualifies real source time separately from receipt time through PA.1, PA.2 and canonical provenance', () => {
    const recommendation = evaluation()
    expect(recommendation.status).toBe('APPROVED_FOR_PAPER_REVIEW')
    expect(recommendation.currentMarketEvidence.candidate).toMatchObject({ sourceObservedAt: OBSERVED, receivedAt: RECEIVED })
    const simulation = simulate(recommendation)
    expect(simulation.status).toBe('SIMULATED_FILLED')
    expect(validateCanonicalEntryProvenance(simulation).valid).toBe(true)
  })

  it.each([
    ['missing', undefined, 'MISSING'],
    ['malformed', 'not-source-time', 'MALFORMED'],
  ])('keeps %s source time unavailable despite a valid server receipt', (_label, sourceTime, status) => {
    const quote = adapterQuote(sourceTime)
    expect(quote.sourceObservedAt).toBeNull()
    expect(quote.updatedAt).toBeNull()
    expect(quote.provenance.sourceTimestampStatus).toBe(status)
    expect(quote.provenance.observedAt).toBeNull()
    expect(quote.provenance.dataStatus).not.toBe('LIVE')
    expect(quote.provenance.receivedAt).toMatch(/Z$/)
    const evidence = compactCurrentMarketEvidence({ quote })
    expect(validateCurrentMarketEvidence(evidence, { now: new Date().toISOString() })).toMatchObject({ valid: false })
    expect(validateCurrentMarketEvidence(evidence, { now: new Date().toISOString() }).reasons)
      .toContain(`current_market_source_observed_at_${status.toLowerCase()}`)
  })

  it('does not let a receipt, compatibility alias, or flattened caller/AI assertions replace explicit missing source time', () => {
    const quote = normalizeQuote({ symbol: 'AAPL', price: 100, sourceObservedAt: null, updatedAt: NOW }, 'finnhub')
    const serviceQuote = toMarketServiceQuote({ ok: true, provider: 'finnhub', data: quote, receivedAt: NOW,
      sourceObservedAt: NOW, observedAt: NOW, dataStatus: 'LIVE' }, 'AAPL')
    expect(serviceQuote.provenance).toMatchObject({ sourceObservedAt: null, receivedAt: NOW, sourceTimestampStatus: 'MISSING' })
    const claimed = provenance({ sourceObservedAt: null, sourceTimestampStatus: 'MISSING', observedAt: NOW, receivedAt: NOW })
    expect(evaluation(claimed).status).not.toBe('APPROVED_FOR_PAPER_REVIEW')
    const simulation = simulate(evaluation(), { ...executionQuote(claimed), sourceObservedAt: NOW, dataStatus: 'LIVE' })
    expect(simulation.status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE')
    expect(simulation.executionFill).toBeNull()
  })

  it.each([
    ['future', '2026-10-01T15:00:01.000Z', '2026-10-01T15:00:02.000Z', 'current_market_observation_in_future'],
    ['receipt precedes source', NOW, OBSERVED, 'current_market_receipt_precedes_observation'],
  ])('rejects %s source chronology', (_label, sourceObservedAt, receivedAt, reason) => {
    const result = evaluation(provenance({ sourceObservedAt, observedAt: sourceObservedAt, receivedAt }))
    expect(result.status).not.toBe('APPROVED_FOR_PAPER_REVIEW')
    expect(result.missingEvidence).toContain(`candidate:${reason}`)
  })

  it('rejects a forged ADMISSIBLE simulation when canonical source time is removed', () => {
    const simulation = structuredClone(simulate())
    simulation.executionRealism.quoteEvidence.sourceObservedAt = null
    simulation.executionRealism.quoteEvidence.sourceTimestampStatus = 'MISSING'
    expect(simulation.executionRealism.paperSimulationAdmissibility.status).toBe('ADMISSIBLE')
    expect(validateCanonicalEntryProvenance(simulation)).toMatchObject({ valid: false })
  })

  it('preserves Finnhub source epoch when supplied and never invents one when omitted', async () => {
    const sourceEpoch = 1_759_334_370
    for (const supplied of [sourceEpoch, undefined]) {
      globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ c: 100, t: supplied }) }))
      const quote = (await createFinnhubClient({ apiKey: 'fixture-key' }).getQuote('AAPL')).data
      expect(quote.sourceObservedAt).toBe(supplied === undefined ? null : new Date(sourceEpoch * 1000).toISOString())
      expect(quote.sourceTimestampStatus).toBe(supplied === undefined ? 'MISSING' : 'VALID')
    }
  })

  it('preserves Twelve Data single and batch source time without receipt substitution', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, headers: { get: () => null },
      json: async () => ({ close: 100, symbol: 'AAPL', last_quote_at: '2026-10-01T14:59:30Z' }) }))
    const client = createTwelveDataClient({ apiKey: 'fixture-key', fetchImpl })
    expect((await client.getQuote('AAPL')).data).toMatchObject({ sourceObservedAt: OBSERVED, sourceTimestampStatus: 'VALID' })
    fetchImpl.mockImplementationOnce(async () => ({ ok: true, headers: { get: () => null },
      json: async () => ({ data: [
        { symbol: 'AAPL', close: 100 },
        { symbol: 'SPY', close: 500, last_quote_at: 'invalid-source-time' },
      ] }) }))
    const batch = (await client.getQuotes(['AAPL', 'SPY'])).data
    expect(batch.map((quote) => [quote.sourceObservedAt, quote.sourceTimestampStatus]))
      .toEqual([[null, 'MISSING'], [null, 'MALFORMED']])
    expect(normalizeSourceObservationTimestamp('2026-10-01T14:59:30Z'))
      .toEqual({ value: OBSERVED, status: 'VALID' })
    expect(normalizeSourceObservationTimestamp('2026-02-30T14:59:30Z'))
      .toEqual({ value: null, status: 'MALFORMED' })
  })
})
