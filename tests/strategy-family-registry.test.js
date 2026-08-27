import { describe, expect, it } from 'vitest'
import { selectStrategiesForRegime } from '../lib/strategies/adaptive/index.js'
import { EXISTING_ADAPTIVE_STRATEGY_RECORDS } from '../lib/strategies/adaptive/strategySuitabilityConfig.js'
import { buildStrategyFamilyRegistry } from '../lib/strategies/registry/index.js'

const regime = { freshness: 'FRESH', classification: { status: 'COMPLETE', trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', confidence: 80 }, inputCoverage: { available: [] } }

describe('governed strategy-family registry', () => {
  it('preserves index-pullback-v1 version and paper-observation lifecycle', () => {
    const indexPullback = buildStrategyFamilyRegistry().strategies.find((strategy) => strategy.strategyId === 'index-pullback-v1')
    expect(indexPullback).toMatchObject({ version: EXISTING_ADAPTIVE_STRATEGY_RECORDS[0].versionReference, lifecycleStatus: 'paper_forward_observation', implementationStatus: 'IMPLEMENTED', paperEligibility: 'PAPER_OBSERVATION', liveEligibility: 'LIVE_DISABLED' })
  })
  it('keeps the existing strategy discoverable and preserves supplied fingerprint', () => {
    const strategies = [{ ...EXISTING_ADAPTIVE_STRATEGY_RECORDS[0], strategyFingerprint: 'existing-fingerprint' }]
    const entry = buildStrategyFamilyRegistry({ strategies }).strategies.find((strategy) => strategy.strategyId === 'index-pullback-v1')
    expect(entry.strategyFingerprint).toBe('existing-fingerprint')
  })
  it('registers all four serious strategies as paper-observation-only implementations', () => {
    const registry = buildStrategyFamilyRegistry(); const entry = registry.strategies.find((strategy) => strategy.strategyId === 'volatility-expansion-v1')
    expect(entry).toMatchObject({ familyId: 'volatility-expansion', implementationStatus: 'IMPLEMENTED', lifecycleStatus: 'paper_forward_observation', paperEligibility: 'PAPER_OBSERVATION', liveEligibility: 'LIVE_DISABLED' }); expect(registry.selectableStrategyIds).toContain('volatility-expansion-v1')
  })
  it('does not enable a strategy merely because it is registered', () => {
    const registry = buildStrategyFamilyRegistry(); const implemented = registry.strategies.find((strategy) => strategy.strategyId === 'volatility-expansion-v1')
    const selection = selectStrategiesForRegime({ regime, strategies: [implemented] })
    expect(selection.strategies[0].decision).toBe('CONDITIONAL')
  })
  it('fails closed on duplicate strategy identifiers', () => expect(() => buildStrategyFamilyRegistry({ strategies: [EXISTING_ADAPTIVE_STRATEGY_RECORDS[0], EXISTING_ADAPTIVE_STRATEGY_RECORDS[0]] })).toThrow('duplicate strategy ids'))
  it('is deterministic, immutable, and does not mutate upstream metadata', () => {
    const before = JSON.stringify(EXISTING_ADAPTIVE_STRATEGY_RECORDS); const first = buildStrategyFamilyRegistry(); const second = buildStrategyFamilyRegistry()
    expect(first).toEqual(second); expect(Object.isFrozen(first)).toBe(true); expect(JSON.stringify(EXISTING_ADAPTIVE_STRATEGY_RECORDS)).toBe(before)
  })
  it('leaves existing Adaptive Strategy Selection and EDGE.2 lifecycle inputs unchanged', () => {
    const before = JSON.stringify(EXISTING_ADAPTIVE_STRATEGY_RECORDS); buildStrategyFamilyRegistry()
    const result = selectStrategiesForRegime({ regime, strategies: EXISTING_ADAPTIVE_STRATEGY_RECORDS })
    expect(result.strategies[0].lifecycleState).toBe('paper_forward_observation'); expect(JSON.stringify(EXISTING_ADAPTIVE_STRATEGY_RECORDS)).toBe(before)
  })
})