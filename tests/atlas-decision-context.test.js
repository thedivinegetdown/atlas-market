import { describe, expect, it } from 'vitest'
import { applyDeterministicDecisionAuthority, buildAtlasDecisionContext } from '../lib/ai/atlasDecisionContext.js'
import { buildAtlasAiContext } from '../lib/ai/atlasAiGateway.js'

describe('Atlas decision context', () => {
  it('contains bounded deterministic decision projections and explicit unavailable evidence', () => {
    const context = buildAtlasDecisionContext({ plans: [{ planId: 'plan-a', symbol: 'AAPL', side: 'long', strategyId: 'index-pullback-v1', version: 'qualified-trade-plan-v1', decision: { status: 'QUALIFIED', supportingReasons: ['Aligned'] }, quality: { score: 85, band: 'QUALIFIED' }, regime: { trendRegime: 'BULL' }, structure: { entry: 100, stop: 98, target: 104 }, risk: { maximumPlannedLoss: 20 }, integrity: { evidenceFingerprint: 'evidence' } }], generatedAt: '2026-08-27T00:00:00.000Z' })
    expect(context.selectedPlan.decisionStatus).toBe('QUALIFIED'); expect(context.evidenceAvailability.empiricalConfidence).toBe('UNAVAILABLE'); expect(context.boundaries).toMatchObject({ executionActionsExposed: false, liveTradingActionsExposed: false })
    expect(buildAtlasAiContext({ requestCategory: 'trade_explanation', contextSources: { atlasDecisionContext: context } }).context.deterministic_context.selectedPlan.symbol).toBe('AAPL')
  })
  it('makes deterministic plan status authoritative over a generated explanation', () => {
    const context = buildAtlasDecisionContext({ plans: [{ planId: 'plan-a', symbol: 'AAPL', decision: { status: 'WATCH' } }] })
    expect(applyDeterministicDecisionAuthority({ summary: 'The setup qualifies.' }, context)).toMatchObject({ deterministicDecisionStatus: 'WATCH', deterministicStatusAuthoritative: true, empiricalConfidence: 'UNAVAILABLE' })
  })
})