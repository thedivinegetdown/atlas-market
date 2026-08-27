import { describe, expect, it } from 'vitest'
import { composeQualifiedTradePlan } from '../lib/opportunities/qualifiedTradePlan/index.js'

const base = (overrides = {}) => ({
  candidate: { opportunityId: 'opp-aapl', symbol: 'AAPL', strategyId: 'index-pullback-v1', timeframe: 'swing', orderContext: { side: 'buy', price: 100, stopPrice: 98, targetPrice: 104, quantity: 10 } },
  tradeQuality: { score: 86, band: 'STRONG', confidence: 82, evidenceCoverage: 100, freshness: 'FRESH', reasons: ['TQ evidence aligned'], blockingReasons: [], missingInputs: [], engineVersion: 'trade-quality-v1', evidenceFingerprint: 'a'.repeat(64) },
  regime: { engineVersion: 'market-regime-v1', freshness: 'FRESH', classification: { status: 'COMPLETE', trendRegime: 'BULL', confidence: 80 } },
  strategySuitability: { engineVersion: 'adaptive-strategy-v1', strategies: [{ strategyId: 'index-pullback-v1', decision: 'ENABLED', confidence: 78, reasons: ['Regime aligned'], blockingReasons: [] }] },
  evaluation: { evaluationId: 'eval-aapl', evidenceFingerprint: 'b'.repeat(64), status: 'APPROVED_FOR_PAPER_REVIEW', freshness: 'FRESH', evaluatedAt: '2026-08-27T12:00:00.000Z', orderContext: { side: 'buy', price: 100, stopPrice: 98, targetPrice: 104, quantity: 10 }, tradeQuality: { score: 86, band: 'STRONG', confidence: 82 }, regime: { status: 'COMPLETE', trendRegime: 'BULL', confidence: 80 }, strategySuitability: { decision: 'ENABLED', confidence: 78 }, riskSafety: { status: 'WITHIN_REVIEW_LIMITS' }, reasons: ['Paper review approved'], blockers: [], missingEvidence: [] },
  riskGate: { approved: true, adjustedQuantity: 10, blockers: [] },
  sizing: { proposedQuantity: 10, allowedQuantity: 10 }, strategyVersion: '1.2.0', strategyFingerprint: 'strategy-fingerprint', policyFingerprint: 'policy-fingerprint',
  ...overrides,
})

describe('canonical Qualified Trade Plan', () => {
  it('composes a fully qualified plan deterministically without mutating input', () => {
    const input = base(); const before = JSON.stringify(input); const first = composeQualifiedTradePlan(input, { generatedAt: '2026-08-27T12:00:00.000Z' }); const second = composeQualifiedTradePlan(input, { generatedAt: '2026-08-27T12:00:00.000Z' })
    expect(first.decision.status).toBe('QUALIFIED'); expect(second).toEqual(first); expect(JSON.stringify(input)).toBe(before); expect(Object.isFrozen(first)).toBe(true)
  })
  it('maps conditional strategy to WATCH', () => expect(composeQualifiedTradePlan(base({ strategySuitability: { strategies: [{ strategyId: 'index-pullback-v1', decision: 'CONDITIONAL', reasons: [], blockingReasons: [] }] }, evaluation: { ...base().evaluation, status: 'WATCH', strategySuitability: { decision: 'CONDITIONAL' } } })).decision.status).toBe('WATCH'))
  it('maps stale evidence to STALE', () => expect(composeQualifiedTradePlan(base({ tradeQuality: { ...base().tradeQuality, freshness: 'STALE' } })).decision.status).toBe('STALE'))
  it('maps missing required evidence to INSUFFICIENT_DATA', () => expect(composeQualifiedTradePlan(base({ tradeQuality: { ...base().tradeQuality, missingInputs: ['liquidity'] } })).decision.status).toBe('INSUFFICIENT_DATA'))
  it('maps hard risk rejection to REJECTED', () => expect(composeQualifiedTradePlan(base({ riskGate: { approved: false, reason: 'Risk blocked', blockers: ['Risk blocked'] } })).decision.status).toBe('REJECTED'))
  it('maps valid non-actionable setup to NO_TRADE', () => expect(composeQualifiedTradePlan(base({ evaluation: { ...base().evaluation, noActionableSetup: true } })).decision.status).toBe('NO_TRADE'))
  it('calculates maximum planned loss and potential target gain', () => { const plan = composeQualifiedTradePlan(base()); expect(plan.risk.maximumPlannedLoss).toBe(20); expect(plan.risk.potentialTargetGain).toBe(40); expect(plan.structure.rMultiple).toBe(2) })
  it('keeps zero quantity non-executable', () => { const plan = composeQualifiedTradePlan(base({ sizing: { allowedQuantity: 0 } })); expect(plan.decision.status).toBe('NO_TRADE'); expect(plan.executable).toBe(false); expect(plan.risk.maximumPlannedLoss).toBe(0) })
  it('preserves provenance and fingerprints', () => { const plan = composeQualifiedTradePlan(base()); expect(plan.integrity).toMatchObject({ strategyFingerprint: 'strategy-fingerprint', policyFingerprint: 'policy-fingerprint', evidenceFingerprint: 'b'.repeat(64) }); expect(plan.market.freshness).toBe('FRESH') })
  it('uses embedded paper-evaluation evidence without requiring duplicate inputs', () => {
    const input = base(); const plan = composeQualifiedTradePlan({ evaluation: input.evaluation, strategySuitability: input.strategySuitability, sizing: input.sizing })
    expect(plan.decision.status).toBe('QUALIFIED'); expect(plan.quality.score).toBe(86)
  })
  it('composes breakout evidence through the canonical plan contract', () => {
    const breakoutSignal = { strategyId: 'breakout-momentum-v1', suitabilityStatus: 'ENABLED', prior20High: 100, breakoutPercent: 2, currentPrice: 102, SMA20: 101, SMA50: 99, SMA200: 90, ADX14: 24, RSI14: 60, relativeVolume: 1.4, relativeStrength: 1, marketParticipation: 'BROAD_STRENGTH', sectorAlignment: 'ALIGNED', evidenceFreshness: 'FRESH', strategyFingerprint: 'breakout-fingerprint' }
    const input = base({ candidate: { ...base().candidate, strategyId: 'breakout-momentum-v1' }, strategyVersion: '1.0.0', strategyFingerprint: null, evaluation: { ...base().evaluation, strategyId: 'breakout-momentum-v1', experimentId: 'BREAKOUT.1', breakoutSignal } })
    const plan = composeQualifiedTradePlan(input)
    expect(plan).toMatchObject({ strategyId: 'breakout-momentum-v1', strategyFamily: 'breakout-momentum', decision: { status: 'QUALIFIED' }, breakout: { level: 100, percent: 2, adx14: 24 }, integrity: { strategyFingerprint: 'breakout-fingerprint', experimentId: 'BREAKOUT.1' } })
  })
})