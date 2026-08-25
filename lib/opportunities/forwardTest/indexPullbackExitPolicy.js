export const INDEX_PULLBACK_EXIT_POLICY_VERSION = 'index-pullback-exit-v1.0.0'
export const INDEX_PULLBACK_STRATEGY_VERSION = '1.2.0'
export const INDEX_PULLBACK_MAX_HOLDING_SESSIONS = 20

const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
const round = (value) => Number(Number(value).toFixed(6))

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((output, key) => {
    output[key] = stable(value[key])
    return output
  }, {})
  return value
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

function policyFingerprint(policy) {
  const source = JSON.stringify(stable(policy))
  return Array.from({ length: 8 }, (_, seed) => {
    let hash = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index) + seed
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
}

const EXIT_POLICY_DEFINITION = Object.freeze({
  version: INDEX_PULLBACK_EXIT_POLICY_VERSION,
  initialStop: 'entry_time_existing_risk_stop',
  profitTarget: 'entry_time_existing_2R_target',
  invalidation: 'initial_stop_reached',
  maximumHoldingSessions: INDEX_PULLBACK_MAX_HOLDING_SESSIONS,
  sameBarAmbiguity: 'stop_first',
  gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target',
  partialExits: false,
  trailingStops: false,
  paperTradingOnly: true,
  liveTradingApproved: false,
})

export const INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT = policyFingerprint(EXIT_POLICY_DEFINITION)

export function createIndexPullbackExitPolicy(input = {}) {
  const strategyId = String(input.strategyId ?? '').trim()
  const strategyVersion = String(input.strategyVersion ?? '').trim()
  const positionSide = input.side === 'short' || input.side === 'sell' ? 'short' : input.side === 'long' || input.side === 'buy' ? 'long' : null
  const entryPrice = Number(input.entryPrice ?? input.referencePrice)
  const initialStop = Number(input.stopPrice ?? input.stopReference)
  const profitTarget = Number(input.targetPrice ?? input.targetReference)
  const enteredAt = new Date(input.enteredAt ?? input.evidenceTimestamp)
  if (strategyId !== 'index-pullback-v1') throw new Error('index-pullback-v1 is required')
  if (!strategyVersion) throw new Error('strategy version is required')
  if (!positionSide || !positive(entryPrice) || !positive(initialStop) || !positive(profitTarget) || Number.isNaN(enteredAt.getTime())) throw new Error('complete entry, stop, target, side, and timestamp evidence is required')
  const validGeometry = positionSide === 'long'
    ? initialStop < entryPrice && profitTarget > entryPrice
    : initialStop > entryPrice && profitTarget < entryPrice
  if (!validGeometry) throw new Error('stop and target geometry is invalid for the position side')
  const riskPerUnit = Math.abs(entryPrice - initialStop)
  const rewardPerUnit = Math.abs(profitTarget - entryPrice)
  const core = {
    version: INDEX_PULLBACK_EXIT_POLICY_VERSION,
    definitionFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT,
    strategyId,
    strategyVersion,
    positionSide,
    enteredAt: enteredAt.toISOString(),
    entryPrice: round(entryPrice),
    initialStop: round(initialStop),
    profitTarget: round(profitTarget),
    rewardRiskRatio: round(rewardPerUnit / riskPerUnit),
    invalidation: 'initial_stop_reached',
    maximumHoldingSessions: INDEX_PULLBACK_MAX_HOLDING_SESSIONS,
    maximumHoldingExit: 'close_of_session_20',
    sameBarAmbiguity: 'stop_first',
    gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target',
    missingOrStaleEvidence: 'fail_closed_no_policy_exit',
    manualEmergencyClose: 'allowed_but_non_policy_compliant_and_excluded_from_cohort_minimum',
    partialExits: false,
    trailingStops: false,
    discretionaryChanges: false,
    deterministic: true,
    manualConfirmationRequired: true,
    paperTradingOnly: true,
    liveTradingApproved: false,
  }
  return freeze({ ...core, fingerprint: policyFingerprint(core) })
}

export function evaluateIndexPullbackExitPolicy({ policy, bar = {}, sessionsHeld = 0 } = {}) {
  if (policy?.version !== INDEX_PULLBACK_EXIT_POLICY_VERSION || policy?.fingerprint !== policyFingerprint(Object.fromEntries(Object.entries(policy).filter(([key]) => key !== 'fingerprint')))) {
    return { action: 'BLOCKED', reason: 'exit_policy_invalid', paperTradingOnly: true }
  }
  const open = Number(bar.open), high = Number(bar.high), low = Number(bar.low), close = Number(bar.close)
  const observedAt = new Date(bar.observedAt ?? bar.timestamp)
  if (String(bar.freshness ?? '').toUpperCase() !== 'FRESH' || [open, high, low, close].some((value) => !positive(value)) || Number.isNaN(observedAt.getTime())) {
    return { action: 'NO_ACTION', reason: 'missing_or_stale_market_evidence', paperTradingOnly: true }
  }
  const long = policy.positionSide === 'long'
  const stopGap = long ? open <= policy.initialStop : open >= policy.initialStop
  const targetGap = long ? open >= policy.profitTarget : open <= policy.profitTarget
  if (stopGap) return { action: 'EXIT_FULL', reason: 'stop_gap', exitPrice: open, conservative: true, paperTradingOnly: true }
  if (targetGap) return { action: 'EXIT_FULL', reason: 'target_gap', exitPrice: policy.profitTarget, conservative: true, paperTradingOnly: true }
  const stopTouched = long ? low <= policy.initialStop : high >= policy.initialStop
  const targetTouched = long ? high >= policy.profitTarget : low <= policy.profitTarget
  if (stopTouched) return { action: 'EXIT_FULL', reason: targetTouched ? 'same_bar_stop_target_stop_first' : 'initial_stop', exitPrice: policy.initialStop, conservative: true, paperTradingOnly: true }
  if (targetTouched) return { action: 'EXIT_FULL', reason: 'profit_target', exitPrice: policy.profitTarget, conservative: true, paperTradingOnly: true }
  if (Number(sessionsHeld) >= policy.maximumHoldingSessions) return { action: 'EXIT_FULL', reason: 'maximum_holding_period', exitPrice: close, conservative: true, paperTradingOnly: true }
  return { action: 'HOLD', reason: 'no_exit_condition_met', paperTradingOnly: true }
}

export function classifyObservationExit({ policy, quantity, positionQuantity, policyDecision, emergency = false } = {}) {
  if (!policy) return { policyCompliant: null, attribution: 'NON_OBSERVATION_EXIT' }
  if (emergency) return { policyCompliant: false, attribution: 'MANUAL_EMERGENCY_CLOSE', countsTowardObservationMinimum: false }
  const fullClose = Number(quantity) === Number(positionQuantity)
  const policyCompliant = fullClose && policyDecision?.action === 'EXIT_FULL'
  return {
    policyCompliant,
    attribution: policyCompliant ? policyDecision.reason : 'DISCRETIONARY_EXIT_REJECTED',
    countsTowardObservationMinimum: policyCompliant,
  }
}
