import { describe, expect, it } from 'vitest'
import {
  createForwardTestEvidenceRecord,
  EDGE1_SYMBOL_UNIVERSE,
} from '../lib/opportunities/forwardTest/forwardTestEvidence.js'

const NOW = '2026-08-24T20:00:00.000Z'

function evidence(overrides = {}) {
  const regime = overrides.regime ?? {
    symbol: 'SPY', asOf: NOW, freshness: 'FRESH',
    classification: { status: 'COMPLETE', trendRegime: 'BULL', volatilityRegime: 'NORMAL', riskRegime: 'RISK_ON', confidence: 82 },
    marketData: { provider: 'twelvedata', dataStatus: 'LIVE', observedAt: NOW, fallbackUsed: false, mock: false },
  }
  const strategySuitability = overrides.strategySuitability ?? {
    strategies: [{ strategyId: 'trend-following', decision: 'ENABLED', confidence: 81, missingInputs: [] }],
  }
  const tradeQuality = overrides.tradeQuality ?? {
    symbol: 'SPY', strategyId: 'trend-following', asOf: NOW, score: 84, band: 'STRONG', confidence: 80,
    status: 'COMPLETE', freshness: 'FRESH', blockingReasons: [], missingInputs: [], marketData: regime.marketData,
  }
  return createForwardTestEvidenceRecord({
    symbol: overrides.symbol ?? 'SPY', regime, strategySuitability, tradeQuality,
    riskGates: overrides.riskGates ?? { evaluated: true, passed: true, blockers: [] },
  })
}

describe('EDGE.1 forward-test evidence baseline', () => {
  it('fixes the bounded production universe', () => {
    expect(EDGE1_SYMBOL_UNIVERSE).toEqual(['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'])
    expect(evidence({ symbol: 'NVDA' })).toMatchObject({ forwardTestEligible: false, blockers: expect.arrayContaining(['symbol_outside_edge1_universe']) })
  })

  it('qualifies only complete real, fresh, supported, risk-approved paper evidence', () => {
    expect(evidence()).toMatchObject({ readiness: 'REAL_DATA_READY', forwardTestEligible: true })
  })

  it('never lets mock evidence become real-data ready', () => {
    const result = evidence({ regime: {
      symbol: 'SPY', asOf: NOW, freshness: 'FRESH', classification: { status: 'COMPLETE', confidence: 90 },
      marketData: { provider: 'mock', dataStatus: 'LIVE', observedAt: NOW, mock: true },
    } })
    expect(result).toMatchObject({ readiness: 'MOCK', forwardTestEligible: false })
  })

  it.each([
    [{ regime: { symbol: 'SPY', freshness: 'STALE', classification: { status: 'COMPLETE' }, marketData: { provider: 'twelvedata', dataStatus: 'STALE' } } }, 'stale_market_evidence'],
    [{ regime: { symbol: 'SPY', freshness: 'FRESH', classification: { status: 'INSUFFICIENT_DATA' }, marketData: { provider: 'twelvedata', dataStatus: 'LIVE' } } }, 'invalid_or_incomplete_regime'],
    [{ strategySuitability: { strategies: [{ strategyId: 'trend-following', decision: 'UNKNOWN' }] } }, 'strategy_not_enabled'],
    [{ tradeQuality: { symbol: 'SPY', strategyId: 'trend-following', score: null, status: 'INSUFFICIENT_DATA', blockingReasons: [], missingInputs: ['volume'] } }, 'trade_quality_evidence_insufficient'],
    [{ riskGates: { evaluated: true, passed: false, blockers: ['portfolio_limit'] } }, 'risk_gates_failed'],
  ])('fails closed when a required eligibility gate is not satisfied', (overrides, blocker) => {
    expect(evidence(overrides)).toMatchObject({ forwardTestEligible: false, blockers: expect.arrayContaining([blocker]) })
  })

  it('keeps degraded real-provider evidence explicit and paper-only', () => {
    const result = evidence({ regime: {
      symbol: 'SPY', asOf: NOW, freshness: 'FRESH', classification: { status: 'COMPLETE', confidence: 80 },
      marketData: { provider: 'twelvedata', dataStatus: 'DEGRADED', observedAt: NOW, fallbackUsed: true, mock: false },
    } })
    expect(result).toMatchObject({
      readiness: 'DEGRADED', forwardTestEligible: true,
      boundaries: { paperOnly: true, automaticExecution: false, liveTrading: false, paidServiceRequired: false },
    })
  })
})
