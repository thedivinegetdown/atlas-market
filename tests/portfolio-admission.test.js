import { describe, expect, it } from 'vitest'
import { buildPortfolioAdmission, composeQualifiedTradePlan, rankQualifiedTradePlans } from '../lib/opportunities/qualifiedTradePlan/index.js'

function plan() {
  return composeQualifiedTradePlan({
    candidate: { opportunityId: 'aapl', symbol: 'AAPL', strategyId: 'index-pullback-v1', orderContext: { side: 'buy', price: 100, stopPrice: 98, targetPrice: 104, quantity: 10 } },
    tradeQuality: { score: 85, band: 'QUALIFIED', confidence: 80, evidenceCoverage: 100, freshness: 'FRESH' },
    regime: { freshness: 'FRESH', classification: { status: 'COMPLETE', trendRegime: 'BULL' } },
    strategySuitability: { strategies: [{ strategyId: 'index-pullback-v1', decision: 'ENABLED' }] },
    evaluation: { evidenceFingerprint: 'evidence', status: 'APPROVED_FOR_PAPER_REVIEW', freshness: 'FRESH', orderContext: { side: 'buy', price: 100, stopPrice: 98, targetPrice: 104, quantity: 10 }, tradeQuality: { score: 85, band: 'QUALIFIED' }, regime: { status: 'COMPLETE', trendRegime: 'BULL' }, strategySuitability: { decision: 'ENABLED' } },
    riskGate: { approved: true }, sizing: { allowedQuantity: 10 },
  }, { generatedAt: '2026-08-27T00:00:00.000Z' })
}

describe('portfolio admission', () => {
  it('admits a qualified plan when scoped exposure is clear', () => {
    const admission = buildPortfolioAdmission({ plan: plan(), positions: [], account: { accountId: 'paper', equity: 100000 }, correlationEvidence: { status: 'CLEAR' }, generatedAt: '2026-08-27T00:00:00.000Z' })
    expect(admission.admissionStatus).toBe('ADMITTED')
    expect(admission.familyId).toBe('trend-pullback')
  })
  it('blocks a duplicate symbol without mutating the plan or promoting it', () => {
    const candidate = plan(); const before = JSON.stringify(candidate)
    const admission = buildPortfolioAdmission({ plan: candidate, positions: [{ accountId: 'paper', symbol: 'AAPL', quantity: 2, currentPrice: 100, strategyId: 'index-pullback-v1', status: 'open' }], account: { accountId: 'paper', equity: 100000 } })
    const ranking = rankQualifiedTradePlans({ plans: [candidate], portfolioAdmissions: [admission] })
    expect(admission).toMatchObject({ admissionStatus: 'BLOCKED', duplicateSymbolStatus: 'CONFLICT', existingSymbolExposure: 200, correlationStatus: 'UNAVAILABLE' })
    expect(ranking.qualified).toEqual([])
    expect(candidate.decision.status).toBe('QUALIFIED'); expect(JSON.stringify(candidate)).toBe(before)
  })
  it('fails conservatively when authoritative positions are unavailable', () => {
    expect(buildPortfolioAdmission({ plan: plan(), account: { accountId: 'paper' } }).admissionStatus).toBe('INSUFFICIENT_DATA')
  })
})