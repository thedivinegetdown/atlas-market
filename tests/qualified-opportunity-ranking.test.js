import { describe, expect, it } from 'vitest'
import { rankQualifiedTradePlans } from '../lib/opportunities/qualifiedTradePlan/index.js'

function plan(symbol, score, status = 'QUALIFIED', overrides = {}) {
  return {
    planId: `qualified-plan-${symbol}`, symbol, side: 'long', strategyId: 'index-pullback-v1', generatedAt: '2026-08-27T12:00:00.000Z', timeframe: 'swing',
    market: { freshness: 'FRESH', provenance: { provider: 'twelvedata', dataStatus: 'LIVE' } }, regime: { trendRegime: 'BULL', confidence: 80 },
    quality: { score, band: 'STRONG', confidence: 82, coverage: 100 }, strategy: { suitability: status === 'WATCH' ? 'CONDITIONAL' : 'ENABLED' },
    structure: { invalidation: 'Invalidated at 98', rMultiple: 2 }, risk: { gateStatus: 'WITHIN_REVIEW_LIMITS', allowedQuantity: 10, maximumPlannedLoss: 20 },
    decision: { status, supportingReasons: ['Evidence aligned'], cautionReasons: [] }, integrity: { evidenceFingerprint: `${symbol.toLowerCase()}-fingerprint` },
    ...overrides,
  }
}

describe('Qualified Trade Plan ranking adapter', () => {
  it('ranks multiple QUALIFIED plans deterministically by existing ranking score', () => {
    const input = { plans: [plan('MSFT', 80), plan('AAPL', 90)] }; const first = rankQualifiedTradePlans(input); const second = rankQualifiedTradePlans(input)
    expect(first).toEqual(second); expect(first.qualified.map((item) => item.symbol)).toEqual(['AAPL', 'MSFT']); expect(first.qualified.map((item) => item.rank)).toEqual([1, 2])
  })
  it('uses deterministic symbol tie-breaking', () => expect(rankQualifiedTradePlans({ plans: [plan('MSFT', 80), plan('AAPL', 80)] }).qualified.map((item) => item.symbol)).toEqual(['AAPL', 'MSFT']))
  it('keeps WATCH plans out of the qualified population', () => { const result = rankQualifiedTradePlans({ plans: [plan('AAPL', 90), plan('MSFT', 80, 'WATCH')] }); expect(result.qualified).toHaveLength(1); expect(result.watch[0].decisionStatus).toBe('WATCH') })
  it.each(['REJECTED', 'NO_TRADE', 'STALE', 'INSUFFICIENT_DATA'])('does not rank %s plans', (status) => { const result = rankQualifiedTradePlans({ plans: [plan('AAPL', 90, status)] }); expect(result.qualified).toEqual([]); expect(result.watch).toEqual([]); expect(result.excludedPlanIds).toEqual(['qualified-plan-AAPL']) })
  it('does not mutate canonical status or risk evidence', () => { const source = plan('AAPL', 90); const before = JSON.stringify(source); rankQualifiedTradePlans({ plans: [source] }); expect(JSON.stringify(source)).toBe(before); expect(source.decision.status).toBe('QUALIFIED'); expect(source.risk.allowedQuantity).toBe(10) })
  it('keeps unavailable portfolio evidence explicit', () => expect(rankQualifiedTradePlans({ plans: [plan('AAPL', 90)] }).portfolioEvidence.status).toBe('UNAVAILABLE'))
  it('preserves the canonical plan reference and fingerprint', () => expect(rankQualifiedTradePlans({ plans: [plan('AAPL', 90)] }).qualified[0].planReference).toEqual({ planId: 'qualified-plan-AAPL', evidenceFingerprint: 'aapl-fingerprint' }))
})