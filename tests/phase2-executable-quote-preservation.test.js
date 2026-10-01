import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { normalizeQuote } from '../lib/market/marketNormalizer.js'
import { normalizeQuoteResponse } from '../lib/market/providerContract.js'
import { createTwelveDataClient } from '../lib/market/twelveDataClient.js'
import { toMarketServiceQuote } from '../lib/market/defaultMarketDataProvider.js'
import { currentMarketEvidenceFingerprint } from '../lib/market/currentMarketEvidenceContract.js'
import { evaluatePaperCandidates } from '../lib/opportunities/paperEvaluation/paperEvaluationEngine.js'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/paperSimulationEngine.js'
import { createCanonicalPaperLedgerRepository, validateCanonicalEntryProvenance } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'

const NOW = '2026-10-01T15:00:00.000Z'
const OBSERVED = '2026-10-01T14:59:30.000Z'
const RECEIVED = '2026-10-01T14:59:31.000Z'
const scope = { tenantContext: { organizationId: 'org-book', teamWorkspaceId: 'team-book', userId: 'user-book' }, accountId: 'paper-portfolio', userId: 'user-book' }

beforeEach(() => vi.useFakeTimers().setSystemTime(new Date(NOW)))
afterEach(() => vi.useRealTimers())

function provenance(sourceObservedAt = OBSERVED, receivedAt = RECEIVED) {
  return { provider: 'twelvedata', dataStatus: 'LIVE', freshness: 'FRESH', fallbackUsed: false,
    mock: false, delayed: false, sourceObservedAt, observedAt: sourceObservedAt,
    sourceTimestampStatus: sourceObservedAt ? 'VALID' : 'MISSING', receivedAt,
    sourceCount: 1, warningCodes: [] }
}

function evaluation(side = 'buy') {
  const candidate = { opportunityId: 'opp-aapl', symbol: 'AAPL', strategyId: 'momentum', score: 86,
    band: 'STRONG', confidence: 82, qualityStatus: 'COMPLETE', blockers: [], missingInputs: [],
    freshness: 'FRESH', asOf: OBSERVED, engineVersion: 'trade-quality-v1', marketData: provenance(),
    orderContext: { assetType: 'equity', side, orderType: 'market', price: 100,
      stopPrice: side === 'short' ? 102 : 98, targetPrice: side === 'short' ? 96 : 104, quantity: 10 } }
  return evaluatePaperCandidates({ candidates: [candidate],
    regime: { symbol: 'SPY', engineVersion: 'market-regime-v1', asOf: OBSERVED, freshness: 'FRESH',
      marketData: provenance(), classification: { trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY',
        riskRegime: 'RISK_ON', status: 'COMPLETE', confidence: 84 } },
    strategySuitability: { engineVersion: 'adaptive-strategy-v1', strategies: [{ strategyId: 'momentum',
      decision: 'ENABLED', confidence: 82, blockingReasons: [] }] },
    portfolioRisk: { maxDrawdown: 2 }, currentMarketEvidence: { symbol: 'SPY', price: 500 },
  }, { now: NOW })[0]
}

function serviceQuote(raw = {}) {
  const quote = normalizeQuoteResponse({ symbol: 'AAPL', price: 100, sourceObservedAt: NOW,
    bid: 99.98, ask: 100.02, bidSize: 25, askSize: 25, ...raw }, 'twelvedata')
  return toMarketServiceQuote({ ...quote, receivedAt: NOW }, 'AAPL')
}

function simulate(quote = serviceQuote(), side = 'buy') {
  return simulateApprovedPaperEvaluations({ evaluations: [evaluation(side)],
    portfolio: { id: 'paper-portfolio', cash: 100000, equity: 100000, buyingPower: 100000, positions: [] },
    portfolioRisk: { account: { accountValue: 100000, cash: 100000, buyingPower: 100000 },
      summary: { openRisk: 0, openRiskPct: 0, drawdownPct: 0 } },
    enabled: true, executionQuotes: [quote],
  }, { now: NOW, confirmedAt: NOW, confirmationSource: 'authenticated_manual_request' }).results[0]
}

describe('Phase 2 executable top-of-book preservation', () => {
  it('preserves valid provider bid, ask and displayed sizes through normalization and PA.2 binding', () => {
    const quote = serviceQuote({ bid: '99.98', ask: '100.02', bid_size: '25', ask_size: '25', bidSize: undefined, askSize: undefined })
    // Explicit canonical fields take precedence over aliases; test aliases separately below.
    expect(quote).toMatchObject({ bid: 99.98, ask: 100.02, bidSize: null, askSize: null })
    expect(normalizeQuote({ symbol: 'AAPL', price: 100, sourceObservedAt: NOW,
      bid: 99.98, ask: 100.02, bid_size: '25', ask_size: '30' }, 'twelvedata'))
      .toMatchObject({ bidSize: 25, askSize: 30 })
    const valid = serviceQuote()
    expect(valid).toMatchObject({ bid: 99.98, ask: 100.02, bidSize: 25, askSize: 25,
      sourceObservedAt: NOW, provenance: { sourceObservedAt: NOW, receivedAt: NOW, dataStatus: 'LIVE' } })
    const result = simulate(valid)
    expect(result.status).toBe('SIMULATED_FILLED')
    expect(result.executionRealism).toMatchObject({ quoteEvidence: { bid: 99.98, ask: 100.02,
      bidSize: 25, askSize: 25, sourceObservedAt: NOW, receivedAt: NOW },
      quantityEvidence: { executableSide: 'ask', displayedSize: 25, fullQuantityDisplayed: true } })
    expect(result.executionFill.referencePrice).toBe(100.02)
    expect(result.executionRealism.quoteEvidenceFingerprint)
      .toBe(currentMarketEvidenceFingerprint(result.executionRealism.quoteEvidence))
    expect(validateCanonicalEntryProvenance(result).valid).toBe(true)
  })

  it('maps genuine Twelve Data single and batch quote fields without deriving unavailable ones', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, headers: { get: () => null },
      json: async () => ({ symbol: 'AAPL', close: 100, bid: '99.98', ask: '100.02',
        bid_size: '25', ask_size: '30', last_quote_at: NOW }) }))
    const client = createTwelveDataClient({ apiKey: 'fixture-key', fetchImpl })
    const single = (await client.getQuote('AAPL')).data
    expect(normalizeQuoteResponse(single, 'twelvedata').data).toMatchObject({
      bid: 99.98, ask: 100.02, bidSize: 25, askSize: 30, sourceObservedAt: NOW })
    fetchImpl.mockImplementationOnce(async () => ({ ok: true, headers: { get: () => null },
      json: async () => ({ data: [
        { symbol: 'AAPL', close: 100, bid: 99.98, ask: 100.02, bid_size: 25, ask_size: 30, last_quote_at: NOW },
        { symbol: 'SPY', close: 500, volume: 100000, last_quote_at: NOW },
      ] }) }))
    const batch = (await client.getQuotes(['AAPL', 'SPY'])).data
    expect(batch[0]).toMatchObject({ bid: 99.98, ask: 100.02, bidSize: 25, askSize: 30 })
    expect(batch[1]).toMatchObject({ bid: undefined, ask: undefined, bidSize: undefined, askSize: undefined })
  })

  it.each([
    ['missing book', { bid: undefined, ask: undefined, bidSize: undefined, askSize: undefined }, ['authoritative_bid', 'authoritative_ask']],
    ['malformed price and size', { bid: 'bad', ask: Infinity, bidSize: -1, askSize: 'bad' }, ['authoritative_bid', 'authoritative_ask', 'authoritative_ask_size']],
    ['crossed book', { bid: 101, ask: 100 }, ['noncrossed_bid_ask']],
    ['last/volume only', { bid: undefined, ask: undefined, bidSize: undefined, askSize: undefined, last: 100, volume: 100000 }, ['authoritative_bid', 'authoritative_ask']],
    ['insufficient ask size', { askSize: 9 }, ['displayed_size_for_full_quantity']],
    ['zero ask size', { askSize: 0 }, ['authoritative_ask_size']],
    ['missing source time', { sourceObservedAt: null, updatedAt: NOW }, ['execution_quote:current_market_source_observed_at_missing']],
  ])('fails closed for %s', (_name, raw, blockers) => {
    const quote = serviceQuote(raw)
    const result = simulate(quote)
    expect(result.status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE')
    expect(result.executionFill).toBeNull()
    expect(result.executionRealism.missingEvidence).toEqual(expect.arrayContaining(blockers))
  })

  it('cannot manufacture bid, ask or size from caller/AI assertions or unrelated volume', () => {
    const raw = normalizeQuote({ symbol: 'AAPL', price: 100, last: 100, volume: 100000,
      orderQuantity: 10, callerBid: 99, aiAsk: 101, aiAskSize: 100,
      sourceObservedAt: NOW }, 'twelvedata')
    expect(raw).toMatchObject({ bid: null, ask: null, bidSize: null, askSize: null })
    const route = readFileSync('netlify/functions/paper-order-simulation.js', 'utf8')
    expect(route).toMatch(/const quote=market\.quote\?\?\{\}/)
    expect(route).not.toMatch(/body\.(?:bid|ask|bidSize|askSize|executionQuotes)/)
  })

  it.each([
    ['stale', { provenance: { ...provenance('2026-10-01T14:55:00.000Z', NOW), freshness: 'STALE' } }],
    ['fallback', { provenance: { ...provenance(NOW, NOW), fallbackUsed: true } }],
    ['mock', { provenance: { ...provenance(NOW, NOW), mock: true } }],
  ])('does not let complete top-of-book override %s provenance', (_name, fields) => {
    const quote = { ...serviceQuote(), ...fields }
    const result = simulate(quote)
    expect(result.status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE')
    expect(result.executionFill).toBeNull()
  })

  it('uses bid and bidSize for an existing supported short-entry simulation', () => {
    const result = simulate(serviceQuote({ bidSize: 10, askSize: 0 }), 'short')
    expect(result.status).toBe('SIMULATED_FILLED')
    expect(result.executionFill.referencePrice).toBe(99.98)
    expect(result.executionRealism.quantityEvidence).toMatchObject({ executableSide: 'bid', displayedSize: 10 })
  })

  it.each([
    ['missing executable size', (realism) => { realism.quoteEvidence.askSize = null }],
    ['insufficient executable size', (realism) => { realism.quoteEvidence.askSize = 9 }],
    ['crossed executable prices', (realism) => { realism.quoteEvidence.bid = 101 }],
    ['contradictory size binding', (realism) => { realism.quantityEvidence.displayedSize = 100 }],
  ])('rejects forged ADMISSIBLE %s before any financial transaction', async (_name, corrupt) => {
    const simulation = structuredClone(simulate())
    expect(simulation.status).toBe('SIMULATED_FILLED')
    corrupt(simulation.executionRealism)
    simulation.executionRealism.quoteEvidenceFingerprint = currentMarketEvidenceFingerprint(simulation.executionRealism.quoteEvidence)
    const database = { connected: true, query: vi.fn(), transaction: vi.fn() }
    await expect(createCanonicalPaperLedgerRepository({ database }).commitEntry({ ...scope, simulation }))
      .rejects.toMatchObject({ code: 'paper_ledger_evidence_missing' })
    expect(database.transaction).not.toHaveBeenCalled()
    expect(database.query).not.toHaveBeenCalled()
  })

  it('admits a valid bound quote into the canonical transaction and retains its fields in the durable payload path', async () => {
    const simulation = simulate()
    const database = { connected: true, query: vi.fn(),
      transaction: vi.fn(async () => { throw new Error('canonical_transaction_reached') }) }
    await expect(createCanonicalPaperLedgerRepository({ database }).commitEntry({ ...scope, simulation }))
      .rejects.toThrow('canonical_transaction_reached')
    expect(database.transaction).toHaveBeenCalledOnce()
    const ledger = readFileSync('lib/opportunities/persistence/canonicalPaperLedgerRepository.js', 'utf8')
    expect(ledger).toMatch(/executionRealism:\s*realism/)
    expect(ledger).toMatch(/executionRealism:\s*input\.executionRealism\s*\?\?\s*null/)
  })

  it('retains the released provenance and PAPER-only boundaries', () => {
    const simulation = simulate()
    expect(simulation).toMatchObject({ paperTradingOnly: true, liveOrders: false,
      brokerExecution: false, automaticExecution: false })
    expect(simulation.executionRealism.quoteEvidence).toMatchObject({ sourceObservedAt: NOW,
      receivedAt: NOW, dataStatus: 'LIVE', fallbackUsed: false, mock: false })
    const diffScopedFiles = ['lib/market/marketNormalizer.js', 'lib/market/twelveDataClient.js',
      'lib/market/currentMarketEvidenceContract.js', 'lib/opportunities/persistence/canonicalPaperLedgerRepository.js']
    for (const file of diffScopedFiles) {
      const content = readFileSync(file, 'utf8')
      expect(content).not.toMatch(/qualifiedProvider|providerAllowlist|dataHealthLatch|liveTradingApproved:\s*true/)
    }
  })
})
