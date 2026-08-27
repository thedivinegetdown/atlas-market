import { describe, expect, it } from 'vitest'
import { buildDecisionIntelligence } from '../lib/intelligence/decisionIntelligenceOrchestrator.js'

const evaluation = { evaluationId: 'eval-aapl', opportunityId: 'opp-aapl', symbol: 'AAPL', strategyId: 'index-pullback-v1', status: 'APPROVED_FOR_PAPER_REVIEW', freshness: 'FRESH', evaluatedAt: '2026-08-27T00:00:00.000Z', orderContext: { side: 'buy', price: 100, stopPrice: 98, targetPrice: 104, quantity: 10 }, tradeQuality: { score: 85, band: 'QUALIFIED', confidence: 80 }, regime: { status: 'COMPLETE', trendRegime: 'BULL' }, strategySuitability: { decision: 'ENABLED' }, evidenceFingerprint: 'evidence', reasons: [], blockers: [], missingEvidence: [] }
const input = (overrides = {}) => ({ tenantContext: { organizationId: 'org-a', userId: 'user-a' }, accountId: 'paper-a', evaluations: [evaluation], positions: [], account: { accountId: 'paper-a', equity: 100000 }, executions: [], generatedAt: '2026-08-27T00:00:00.000Z', ...overrides })

describe('decision intelligence orchestration', () => {
  it('composes bounded immutable tenant-scoped deterministic evidence', async () => {
    const source = input(); const before = JSON.stringify(source)
    const result = await buildDecisionIntelligence(source)
    expect(result).toMatchObject({ version: 'atlas-decision-intelligence-v1', identity: { organizationId: 'org-a', accountId: 'paper-a' }, opportunities: { qualifiedCount: 1 }, boundaries: { liveExecutionDisabled: true, empiricalConfidence: 'UNAVAILABLE', executableActionsExposed: false } })
    expect(result.opportunities.topQualifiedPlans).toHaveLength(1); expect(result.decisionQuality.rNormalized.status).toBe('UNAVAILABLE'); expect(JSON.stringify(source)).toBe(before)
  })
  it('does not manufacture plans and treats unknown selected plans as unavailable', async () => {
    const result = await buildDecisionIntelligence(input({ evaluations: [], selectedPlanId: 'other-tenant-plan' }))
    expect(result.opportunities.emptyQualifiedState).toBe('NO_QUALIFIED_OPPORTUNITIES'); expect(result.selectedDecision).toBeNull(); expect(result.copilotContext.selectedPlan).toBeNull()
  })
  it('keeps blocked duplicate-symbol plans out of qualified ranking', async () => {
    const result = await buildDecisionIntelligence(input({ positions: [{ accountId: 'paper-a', symbol: 'AAPL', quantity: 5, currentPrice: 100, status: 'open', strategyId: 'index-pullback-v1' }] }))
    expect(result.opportunities.qualifiedCount).toBe(0); expect(result.opportunities.blockedCount).toBe(1); expect(result.opportunities.emptyQualifiedState).toBe('NO_QUALIFIED_OPPORTUNITIES')
  })
})