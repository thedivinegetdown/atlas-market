import { describe, expect, it } from 'vitest'
import { buildDecisionQualityMonitor } from '../lib/analytics/decisionQualityMonitor.js'

function outcome(pnl, index, extra = {}) {
  return { id: `outcome-${index}`, status: 'SIMULATED_FILLED', accountingStatus: 'position_closed', realizedPnl: pnl, paperTradingOnly: true, strategyId: 'index-pullback-v1', simulatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, tradeQuality: { band: 'STRONG', score: 85 }, regime: { trendRegime: 'BULL' }, evaluationStatus: 'APPROVED_FOR_PAPER_REVIEW', qualifiedTradePlan: { risk: { maximumPlannedLoss: 100 }, integrity: { strategyFingerprint: 'strategy-a', policyFingerprint: 'policy-a' } }, ...extra }
}

describe('decision quality monitor', () => {
  it('reuses completed performance metrics and derives valid R from immutable planned loss', () => {
    const monitor = buildDecisionQualityMonitor({ outcomes: [outcome(100, 0), outcome(-50, 1), outcome(200, 2), outcome(-100, 3), outcome(0, 4)], generatedAt: '2026-08-27T00:00:00.000Z' })
    expect(monitor.overall).toMatchObject({ completedOutcomes: 5, wins: 2, losses: 2, expectancy: 30, profitFactor: 2 })
    expect(monitor.rNormalized).toMatchObject({ status: 'AVAILABLE', metrics: { averageR: 0.3, medianR: 0, bestR: 2, worstR: -1 } })
    expect(monitor.groupings.byStrategyFamily[0].familyId).toBe('trend-pullback')
  })
  it('keeps R unavailable and trend conservative without complete immutable risk evidence', () => {
    const monitor = buildDecisionQualityMonitor({ outcomes: [outcome(100, 0, { qualifiedTradePlan: {} })], generatedAt: '2026-08-27T00:00:00.000Z' })
    expect(monitor.status).toBe('INSUFFICIENT_SAMPLE'); expect(monitor.rNormalized.status).toBe('UNAVAILABLE'); expect(monitor.recentTrend).toBe('INSUFFICIENT_DATA')
  })
  it('does not silently merge incompatible fingerprints or mutate outcomes', () => {
    const outcomes = [outcome(50, 0), outcome(-20, 1, { qualifiedTradePlan: { risk: { maximumPlannedLoss: 100 }, integrity: { strategyFingerprint: 'strategy-b', policyFingerprint: 'policy-b' } } })]; const before = JSON.stringify(outcomes)
    const monitor = buildDecisionQualityMonitor({ outcomes, generatedAt: '2026-08-27T00:00:00.000Z' })
    expect(monitor.compatibility.status).toBe('INCOMPATIBLE_HISTORY'); expect(monitor.boundaries.automaticOptimization).toBe(false); expect(JSON.stringify(outcomes)).toBe(before)
  })
})