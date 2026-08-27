import { describe, expect, it } from 'vitest'
import { createRangeMeanReversionExitPolicy, evaluateRangeMeanReversionExitPolicy } from '../lib/opportunities/forwardTest/rangeMeanReversionExitPolicy.js'

const policy = (overrides = {}) => createRangeMeanReversionExitPolicy({ strategyId: 'range-mean-reversion-v1', strategyVersion: '1.0.0', entryPrice: 100, prior20Low: 90, sma20: 110, atr14: 5, enteredAt: '2026-08-27T00:00:00.000Z', ...overrides })
const bar = { open: 101, high: 102, low: 100, close: 101, freshness: 'FRESH' }
describe('range mean reversion exit policy', () => {
  it('freezes the stop formula, mean target, and sufficient reward-risk geometry', () => expect(policy()).toMatchObject({ initialStop: 92.5, profitTarget: 110, riskPerUnit: 7.5, rewardRiskRatio: 1.333333, maximumHoldingSessions: 10 }))
  it('rejects invalid target and reward-risk geometry', () => { expect(() => policy({ sma20: 100 })).toThrow(); expect(() => policy({ sma20: 108 })).toThrow() })
  it('uses stop-first ambiguity, conservative gap rules, and a ten-session hold', () => { expect(evaluateRangeMeanReversionExitPolicy({ policy: policy(), bar: { ...bar, high: 112, low: 92 } }).reason).toBe('same_bar_stop_target_stop_first'); expect(evaluateRangeMeanReversionExitPolicy({ policy: policy(), bar: { ...bar, open: 90 } })).toMatchObject({ reason: 'stop_gap', exitPrice: 90 }); expect(evaluateRangeMeanReversionExitPolicy({ policy: policy(), bar: { ...bar, open: 112 } })).toMatchObject({ reason: 'target_gap', exitPrice: 110 }); expect(evaluateRangeMeanReversionExitPolicy({ policy: policy(), bar, sessionsHeld: 10 }).reason).toBe('maximum_holding_period') })
  it('fails closed for stale evidence', () => expect(evaluateRangeMeanReversionExitPolicy({ policy: policy(), bar: { ...bar, freshness: 'STALE' } }).reason).toBe('missing_or_stale_market_evidence'))
})