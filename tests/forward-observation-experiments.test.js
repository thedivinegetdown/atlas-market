import { describe, expect, it } from 'vitest'
import { BREAKOUT_OBSERVATION_UNIVERSE, buildForwardObservationStatus, createBreakoutObservationExperimentDefinition, createForwardEvidenceSnapshot, createForwardObservationManifest } from '../lib/opportunities/forwardTest/forwardObservationEngine.js'
import { BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT, BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION, createBreakoutMomentumExitPolicy } from '../lib/opportunities/forwardTest/breakoutMomentumExitPolicy.js'

const startedAt = '2026-08-27T00:00:00.000Z'
function definition() { return createBreakoutObservationExperimentDefinition({ strategyFingerprint: 'breakout-strategy', createdAt: startedAt }) }
function manifest() { return createForwardObservationManifest({ observationId: 'breakout-2026-08-27', startedAt, experimentDefinition: definition(), regimeEngineVersion: 'market-regime-v1', tradeQualityVersion: 'trade-quality-v1', riskPolicyVersion: 'trade-guardrail-v1', startingPaperAccount: { accountId: 'paper', cash: 100000, buyingPower: 100000, equity: 100000 }, exitPolicy: { version: BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION, policyFingerprint: BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true, maximumHoldingSessions: 10, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target' } }) }
describe('independent forward observation experiments', () => {
  it('freezes the separate BREAKOUT.1 definition and does not start a cohort', () => { const result = definition(); expect(result).toMatchObject({ experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', observationUniverse: [...BREAKOUT_OBSERVATION_UNIVERSE].sort(), minimumTradingSessions: 20, minimumCompletedOutcomes: 30 }); expect(Object.isFrozen(result)).toBe(true); expect(buildForwardObservationStatus({}).status).toBe('NOT_STARTED') })
  it('isolates eligible breakout evidence with its own experiment attribution', () => {
    const observation = manifest(); const exitPolicy = createBreakoutMomentumExitPolicy({ strategyId: 'breakout-momentum-v1', strategyVersion: '1.0.0', entryPrice: 120, breakoutLevel: 119, atr14: 3, enteredAt: startedAt, strategyFingerprint: 'breakout-strategy' })
    const snapshot = createForwardEvidenceSnapshot({ manifest: observation, evidence: { forwardTestEligible: true, symbol: 'SPY', strategyId: 'breakout-momentum-v1', timestamp: startedAt, providerProvenance: { provider: 'twelvedata', dataStatus: 'LIVE' }, tradeQuality: { score: 80 } }, entryContext: { exitPolicy, referencePrice: 120 } })
    expect(snapshot).toMatchObject({ experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1' })
    expect(() => createForwardEvidenceSnapshot({ manifest: observation, evidence: { forwardTestEligible: true, strategyId: 'index-pullback-v1' } })).toThrow('evidence strategy')
  })
})