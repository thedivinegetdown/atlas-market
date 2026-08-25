import { describe, expect, it } from 'vitest'
import { reviewPaperPerformance } from '../lib/analytics/paperPerformanceReview.js'
import { createForwardObservationManifest, evaluateForwardObservationConfiguration } from '../lib/opportunities/forwardTest/forwardObservationEngine.js'
import {
  classifyObservationExit,
  createIndexPullbackExitPolicy,
  evaluateIndexPullbackExitPolicy,
  INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT,
  INDEX_PULLBACK_EXIT_POLICY_VERSION,
} from '../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'
import { simulatePaperPositionExit } from '../lib/opportunities/paperExit/paperExitEngine.js'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/paperSimulationEngine.js'

const NOW = '2026-08-25T14:00:00.000Z'
const longPolicy = () => createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', side: 'long', entryPrice: 100, stopPrice: 98, targetPrice: 104, enteredAt: NOW })
const shortPolicy = () => createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', side: 'short', entryPrice: 100, stopPrice: 102, targetPrice: 96, enteredAt: NOW })
const bar = (overrides = {}) => ({ open: 100, high: 101, low: 99, close: 100, observedAt: NOW, freshness: 'FRESH', ...overrides })

function manifest() {
  return createForwardObservationManifest({
    observationId: 'edge2-policy-test', startedAt: NOW, strategyVersions: { 'index-pullback-v1': '1.2.0' },
    regimeEngineVersion: 'market-regime-v1', tradeQualityVersion: 'trade-quality-v1', riskPolicyVersion: 'trade-guardrail-v1',
    startingPaperAccount: { accountId: 'paper-portfolio', cash: 100000, buyingPower: 100000, equity: 100000, revision: 0 },
    exitPolicy: { version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true, manualConfirmationRequired: true, maximumHoldingSessions: 20, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target' },
  })
}

describe('index-pullback-v1 deterministic paper observation exits', () => {
  it('freezes existing stop and 2R target evidence with exact strategy attribution', () => {
    const policy = longPolicy()
    expect(policy).toMatchObject({ version: INDEX_PULLBACK_EXIT_POLICY_VERSION, strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', initialStop: 98, profitTarget: 104, rewardRiskRatio: 2, maximumHoldingSessions: 20, deterministic: true, paperTradingOnly: true, liveTradingApproved: false })
    expect(Object.isFrozen(policy)).toBe(true)
    expect(() => { policy.initialStop = 99 }).toThrow()
  })

  it.each([
    ['long stop', longPolicy(), bar({ low: 97.5 }), 'initial_stop', 98],
    ['long target', longPolicy(), bar({ high: 105 }), 'profit_target', 104],
    ['short stop', shortPolicy(), bar({ high: 103 }), 'initial_stop', 102],
    ['short target', shortPolicy(), bar({ low: 95 }), 'profit_target', 96],
  ])('resolves %s objectively', (_label, policy, evidence, reason, price) => {
    expect(evaluateIndexPullbackExitPolicy({ policy, bar: evidence })).toMatchObject({ action: 'EXIT_FULL', reason, exitPrice: price })
  })

  it('uses stop-first for same-bar ambiguity and cannot improve the outcome discretionarily', () => {
    const result = evaluateIndexPullbackExitPolicy({ policy: longPolicy(), bar: bar({ high: 105, low: 97 }) })
    expect(result).toMatchObject({ reason: 'same_bar_stop_target_stop_first', exitPrice: 98, conservative: true })
  })

  it('prices adverse stop gaps at open and caps favorable target gaps at target', () => {
    expect(evaluateIndexPullbackExitPolicy({ policy: longPolicy(), bar: bar({ open: 95, high: 96, low: 94, close: 95 }) })).toMatchObject({ reason: 'stop_gap', exitPrice: 95 })
    expect(evaluateIndexPullbackExitPolicy({ policy: longPolicy(), bar: bar({ open: 106, high: 108, low: 105, close: 107 }) })).toMatchObject({ reason: 'target_gap', exitPrice: 104 })
  })

  it('exits at session 20 close and fails closed on stale or missing evidence', () => {
    expect(evaluateIndexPullbackExitPolicy({ policy: longPolicy(), bar: bar({ close: 101 }), sessionsHeld: 20 })).toMatchObject({ reason: 'maximum_holding_period', exitPrice: 101 })
    expect(evaluateIndexPullbackExitPolicy({ policy: longPolicy(), bar: bar({ freshness: 'STALE' }) })).toMatchObject({ action: 'NO_ACTION', reason: 'missing_or_stale_market_evidence' })
    expect(evaluateIndexPullbackExitPolicy({ policy: longPolicy(), bar: { freshness: 'FRESH' } })).toMatchObject({ action: 'NO_ACTION' })
  })

  it('makes emergency closes non-policy outcomes and rejects partial/discretionary attribution', () => {
    expect(classifyObservationExit({ policy: longPolicy(), quantity: 100, positionQuantity: 100, emergency: true })).toMatchObject({ attribution: 'MANUAL_EMERGENCY_CLOSE', countsTowardObservationMinimum: false })
    expect(classifyObservationExit({ policy: longPolicy(), quantity: 50, positionQuantity: 100, policyDecision: { action: 'EXIT_FULL' } })).toMatchObject({ policyCompliant: false, attribution: 'DISCRETIONARY_EXIT_REJECTED' })
  })

  it('invalidates the cohort when the exit-policy fingerprint changes', () => {
    expect(evaluateForwardObservationConfiguration(manifest(), { exitPolicy: { ...manifest().exitPolicy, policyFingerprint: 'changed' } })).toMatchObject({ compatible: false, status: 'INVALIDATED' })
  })

  it('attaches the immutable policy at PA.2 entry without automatic or live execution', () => {
    const evaluation = { evaluationId: 'eval-1', candidateId: 'candidate-1', symbol: 'SPY', strategyId: 'index-pullback-v1', status: 'APPROVED_FOR_PAPER_REVIEW', freshness: 'FRESH', evaluatedAt: NOW, orderContext: { assetType: 'equity', side: 'buy', price: 100, stopPrice: 98, targetPrice: 104 } }
    const result = simulateApprovedPaperEvaluations({ evaluations: [evaluation], portfolio: { cash: 100000, equity: 100000, buyingPower: 100000, positions: [] }, enabled: true }, { now: NOW })
    expect(result.results[0]).toMatchObject({ status: 'SIMULATED_FILLED', exitPolicy: { version: INDEX_PULLBACK_EXIT_POLICY_VERSION, liveTradingApproved: false }, automaticExecution: false, liveOrders: false })
    expect(result.results[0].orderPlan.exitPolicy.fingerprint).toBe(result.results[0].exitPolicy.fingerprint)
  })

  it('integrates policy-trigger attribution with PA.4 and PA.3 realized evidence', () => {
    const position = { positionId: 'pos-1', symbol: 'SPY', assetType: 'equity', side: 'long', quantity: 10, averagePrice: 100, currentPrice: 100, originatingEvaluationId: 'eval-1', strategyId: 'index-pullback-v1', exitPolicy: longPolicy() }
    const result = simulatePaperPositionExit({ position, account: { accountId: 'paper', cash: 99000, equity: 100000, realizedPnl: 0 }, quantity: 10, quote: { price: 98, updatedAt: NOW }, policyBar: bar({ high: 100, low: 97, close: 98 }), paperModeEnabled: true }, { now: NOW })
    expect(result).toMatchObject({ status: 'POSITION_CLOSED', exitAttribution: { policyCompliant: true, attribution: 'initial_stop', countsTowardObservationMinimum: true } })
    const review = reviewPaperPerformance([{ id: result.fingerprint, status: 'SIMULATED_FILLED', accountingStatus: 'position_closed', strategyId: result.strategyId, realizedPnl: result.exitPlan.realizedPnlDelta, closedAt: result.closedAt, exitAttribution: result.exitAttribution, paperTradingOnly: true }], { asOf: NOW })
    expect(review.sample.completedTrades).toBe(1)
  })

  it('rejects observation partial exits and preserves an explicit emergency-close audit path', () => {
    const position = { positionId: 'pos-1', symbol: 'SPY', assetType: 'equity', side: 'long', quantity: 10, averagePrice: 100, currentPrice: 100, originatingEvaluationId: 'eval-1', strategyId: 'index-pullback-v1', exitPolicy: longPolicy() }
    const partial = simulatePaperPositionExit({ position, account: { accountId: 'paper', cash: 99000, equity: 100000 }, quantity: 5, quote: { price: 98, updatedAt: NOW }, policyBar: bar({ low: 97 }), paperModeEnabled: true }, { now: NOW })
    expect(partial).toMatchObject({ status: 'REJECTED', exitAttribution: { policyCompliant: false } })
    const emergency = simulatePaperPositionExit({ position, account: { accountId: 'paper', cash: 99000, equity: 100000 }, quantity: 10, quote: { price: 99, updatedAt: NOW }, exitReason: 'manual_emergency', paperModeEnabled: true }, { now: NOW })
    expect(emergency).toMatchObject({ status: 'POSITION_CLOSED', exitAttribution: { attribution: 'MANUAL_EMERGENCY_CLOSE', countsTowardObservationMinimum: false } })
  })
})
