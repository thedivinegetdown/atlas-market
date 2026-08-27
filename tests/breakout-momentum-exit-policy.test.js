import { describe, expect, it } from 'vitest'
import { createBreakoutMomentumExitPolicy, evaluateBreakoutMomentumExitPolicy } from '../lib/opportunities/forwardTest/breakoutMomentumExitPolicy.js'

function policy(overrides = {}) { return createBreakoutMomentumExitPolicy({ strategyId: 'breakout-momentum-v1', strategyVersion: '1.0.0', entryPrice: 120, breakoutLevel: 119, atr14: 3, enteredAt: '2026-08-01T00:00:00.000Z', ...overrides }) }
const bar = { open: 121, high: 122, low: 120, close: 121, freshness: 'FRESH' }
describe('breakout momentum exit policy', () => {
  it('freezes the deterministic stop and exact 2R target', () => { expect(policy()).toMatchObject({ initialStop: 116, profitTarget: 128, riskPerUnit: 4, rewardRiskRatio: 2 }) })
  it('rejects invalid stop geometry', () => { expect(() => policy({ breakoutLevel: 130, atr14: 1 })).toThrow('initial stop') })
  it('uses stop-first ambiguity, gap rules, and maximum holding', () => {
    expect(evaluateBreakoutMomentumExitPolicy({ policy: policy(), bar: { ...bar, high: 133, low: 113 } }).reason).toBe('same_bar_stop_target_stop_first')
    expect(evaluateBreakoutMomentumExitPolicy({ policy: policy(), bar: { ...bar, open: 112 } })).toMatchObject({ reason: 'stop_gap', exitPrice: 112 })
    expect(evaluateBreakoutMomentumExitPolicy({ policy: policy(), bar: { ...bar, open: 133 } })).toMatchObject({ reason: 'target_gap', exitPrice: 128 })
    expect(evaluateBreakoutMomentumExitPolicy({ policy: policy(), bar, sessionsHeld: 10 }).reason).toBe('maximum_holding_period')
  })
  it('fails closed for stale evidence', () => expect(evaluateBreakoutMomentumExitPolicy({ policy: policy(), bar: { ...bar, freshness: 'STALE' } }).reason).toBe('missing_or_stale_market_evidence'))
})