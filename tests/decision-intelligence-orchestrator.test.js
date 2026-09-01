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
  it('projects every governed strategy as insufficient when no current candidate evidence exists', async () => {
    const result = await buildDecisionIntelligence(input({ evaluations: [] }))
    const expectedStrategyIds = ['breakout-momentum-v1', 'index-pullback-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1']
    expect(result.strategyAssessments.map((entry) => entry.strategyId)).toEqual(expectedStrategyIds)
    expect(result.strategyAssessments.every((entry) => entry.status === 'INSUFFICIENT_DATA')).toBe(true)
    expect(result.strategyAssessments.every((entry) => entry.noTradeReason === 'No current evaluated candidate evidence is available.')).toBe(true)
    expect(result.copilotContext.strategyAssessments.map((entry) => entry.strategyId)).toEqual(expectedStrategyIds)
    expect(result.opportunities.emptyQualifiedState).toBe('NO_QUALIFIED_OPPORTUNITIES')
  })
  it('keeps blocked duplicate-symbol plans out of qualified ranking', async () => {
    const result = await buildDecisionIntelligence(input({ positions: [{ accountId: 'paper-a', symbol: 'AAPL', quantity: 5, currentPrice: 100, status: 'open', strategyId: 'index-pullback-v1' }] }))
    expect(result.opportunities.qualifiedCount).toBe(0); expect(result.opportunities.blockedCount).toBe(1); expect(result.opportunities.emptyQualifiedState).toBe('NO_QUALIFIED_OPPORTUNITIES')
  })
  it('exposes bounded independent observation statuses to intelligence and Copilot', async () => {
    const result = await buildDecisionIntelligence(input({ observationStatuses: [{ experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', status: 'COLLECTING', sessionsElapsed: 3, completedOutcomes: 1 }, { experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', status: 'NOT_STARTED', blockers: ['no_qualifying_candidate'] }] }))
    expect(result.observations).toHaveLength(2); expect(result.copilotContext.observations[1]).toMatchObject({ experimentId: 'BREAKOUT.1', status: 'NOT_STARTED', blockers: ['no_qualifying_candidate'] })
  })
  it('projects bounded attributable strategy assessments to intelligence and Copilot', async () => {
    const result = await buildDecisionIntelligence(input({ evaluations: [{ ...evaluation, strategyId: 'volatility-expansion-v1', volatilityExpansionSignal: { suitabilityStatus: 'ENABLED', strategyFingerprint: 'volatility-fingerprint' } }] }))
    expect(result.strategyAssessments).toContainEqual(expect.objectContaining({ strategyId: 'volatility-expansion-v1', status: 'QUALIFIED', evidenceType: 'volatility-expansion' }))
    expect(result.copilotContext.strategyAssessments).toContainEqual(expect.objectContaining({ strategyId: 'volatility-expansion-v1', status: 'QUALIFIED' }))
    expect(new Set(result.strategyAssessments.map((entry) => entry.strategyId))).toEqual(new Set(['index-pullback-v1', 'breakout-momentum-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1']))
  })
  it('keeps zero-quantity no-trade explanations deterministic and bounded', async () => {
    const result = await buildDecisionIntelligence(input({ evaluations: [{ ...evaluation, orderContext: { ...evaluation.orderContext, quantity: 0 } }] }))
    expect(result.opportunities.noTradeReasons).toEqual([{ strategyId: 'index-pullback-v1', reason: 'Risk sizing allowed zero quantity.' }])
  })
  it('keeps completed outcomes grouped by their persisted experiment identity', async () => {
    const result = await buildDecisionIntelligence(input({ executions: [{ executionId: 'edge-exit', executionType: 'close', experimentId: 'EDGE.2', symbol: 'SPY', strategyId: 'index-pullback-v1', realizedPnlDelta: 10 }, { executionId: 'breakout-exit', executionType: 'close', experimentId: 'BREAKOUT.1', symbol: 'AAPL', strategyId: 'breakout-momentum-v1', realizedPnlDelta: 5 }] }))
    expect(result.decisionQuality.groupings.byExperimentId).toEqual(expect.arrayContaining([{ experimentId: 'EDGE.2', compatibilityStatus: 'SEPARATE_COHORT' }, { experimentId: 'BREAKOUT.1', compatibilityStatus: 'SEPARATE_COHORT' }]))
  })
})
