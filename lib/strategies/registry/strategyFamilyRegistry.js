import { EXISTING_ADAPTIVE_STRATEGY_RECORDS } from '../adaptive/strategySuitabilityConfig.js'
import { INDEX_PULLBACK_EXIT_POLICY_VERSION, INDEX_PULLBACK_STRATEGY_VERSION } from '../../opportunities/forwardTest/indexPullbackExitPolicy.js'
import { BREAKOUT_MOMENTUM_STRATEGY_VERSION } from '../breakout/breakoutMomentumSignal.js'
import { BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION } from '../../opportunities/forwardTest/breakoutMomentumExitPolicy.js'
import { RANGE_MEAN_REVERSION_STRATEGY_VERSION } from '../range/rangeMeanReversionSignal.js'
import { RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION } from '../../opportunities/forwardTest/rangeMeanReversionExitPolicy.js'

export const STRATEGY_FAMILY_REGISTRY_VERSION = 'strategy-family-registry-v1'

const PLACEHOLDER_FAMILIES = Object.freeze([
  Object.freeze({ strategyId: 'volatility-expansion-v1', familyId: 'volatility-expansion', displayName: 'Volatility Expansion' }),
])

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

function implementedRecord(record = {}) {
  const strategyId = String(record.strategyId ?? '').trim()
  return {
    strategyId,
    familyId: strategyId === 'index-pullback-v1' ? 'trend-pullback' : strategyId === 'breakout-momentum-v1' ? 'breakout-momentum' : strategyId === 'range-mean-reversion-v1' ? 'range-mean-reversion' : 'unclassified',
    displayName: record.strategyName ?? strategyId,
    version: record.versionReference ?? (strategyId === 'index-pullback-v1' ? INDEX_PULLBACK_STRATEGY_VERSION : strategyId === 'breakout-momentum-v1' ? BREAKOUT_MOMENTUM_STRATEGY_VERSION : strategyId === 'range-mean-reversion-v1' ? RANGE_MEAN_REVERSION_STRATEGY_VERSION : null),
    lifecycleStatus: record.lifecycleState ?? record.status ?? 'unknown',
    implementationStatus: 'IMPLEMENTED',
    allowedEnvironments: ['paper'],
    paperEligibility: record.paperForwardObservationApproved === true ? 'PAPER_OBSERVATION' : 'INACTIVE',
    liveEligibility: 'LIVE_DISABLED',
    requiredEvidence: [...(record.requiredIndicators ?? [])],
    exitPolicyId: strategyId === 'index-pullback-v1' ? INDEX_PULLBACK_EXIT_POLICY_VERSION : strategyId === 'breakout-momentum-v1' ? BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION : strategyId === 'range-mean-reversion-v1' ? RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION : null,
    strategyFingerprint: record.strategyFingerprint ?? null,
    reasons: ['Registration does not alter adaptive selection or lifecycle eligibility.'],
  }
}

function placeholderRecord(record) {
  return {
    ...record,
    version: null,
    lifecycleStatus: 'INACTIVE',
    implementationStatus: 'NOT_IMPLEMENTED',
    allowedEnvironments: [],
    paperEligibility: 'INACTIVE',
    liveEligibility: 'LIVE_DISABLED',
    requiredEvidence: [],
    exitPolicyId: null,
    strategyFingerprint: null,
    reasons: ['Placeholder only. No entry rules, exit rules, thresholds, or executable eligibility exist.'],
  }
}

export function buildStrategyFamilyRegistry({ strategies = EXISTING_ADAPTIVE_STRATEGY_RECORDS, placeholders = PLACEHOLDER_FAMILIES } = {}) {
  const implemented = strategies.map(implementedRecord)
  const entries = [...implemented, ...placeholders.map(placeholderRecord)]
  const ids = entries.map((entry) => entry.strategyId)
  if (new Set(ids).size !== ids.length) throw new Error('strategy registry contains duplicate strategy ids')
  const sorted = entries.sort((left, right) => left.strategyId.localeCompare(right.strategyId))
  return freeze({
    version: STRATEGY_FAMILY_REGISTRY_VERSION,
    strategies: sorted,
    selectableStrategyIds: sorted.filter((entry) => entry.implementationStatus === 'IMPLEMENTED' && entry.paperEligibility === 'PAPER_OBSERVATION').map((entry) => entry.strategyId),
    boundaries: { discoveryOnly: true, registrationEnablesStrategy: false, automaticActivation: false, paperTradingOnly: true, liveTrading: false },
  })
}