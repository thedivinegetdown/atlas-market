export const BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION = 'breakout-momentum-exit-v1.0.0'
export const BREAKOUT_MOMENTUM_MAX_HOLDING_SESSIONS = 10

const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
const round = (value) => Number(Number(value).toFixed(6))
const stable = (value) => value && typeof value === 'object' ? Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: stable(value[key]) }), {}) : value
const fingerprint = (value) => Array.from({ length: 8 }, (_, seed) => Array.from(JSON.stringify(stable(value))).reduce((hash, character) => Math.imul(hash ^ (character.charCodeAt(0) + seed), 0x01000193) >>> 0, 0x811c9dc5).toString(16).padStart(8, '0')).join('')

const DEFINITION = Object.freeze({ version: BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION, stop: 'max(breakout_level-atr14,entry_price-(2*atr14))', target: 'entry_price+(2*r)', maximumHoldingSessions: BREAKOUT_MOMENTUM_MAX_HOLDING_SESSIONS, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target', trailingStops: false, partialExits: false, paperTradingOnly: true, liveTradingApproved: false })
export const BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT = fingerprint(DEFINITION)

export function createBreakoutMomentumExitPolicy(input = {}) {
  const entryPrice = Number(input.entryPrice); const breakoutLevel = Number(input.breakoutLevel); const atr14 = Number(input.atr14)
  const enteredAt = new Date(input.enteredAt ?? input.evidenceTimestamp)
  if (input.strategyId !== 'breakout-momentum-v1' || !String(input.strategyVersion ?? '').trim()) throw new Error('breakout-momentum-v1 strategy identity and version are required')
  if (![entryPrice, breakoutLevel, atr14].every(positive) || Number.isNaN(enteredAt.getTime())) throw new Error('complete entry, breakout level, ATR14, and timestamp evidence is required')
  const initialStop = Math.max(breakoutLevel - atr14, entryPrice - (2 * atr14))
  if (!(initialStop < entryPrice)) throw new Error('initial stop must be below entry price')
  const riskPerUnit = entryPrice - initialStop
  const core = { version: BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION, definitionFingerprint: BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT, strategyId: input.strategyId, strategyVersion: input.strategyVersion, positionSide: 'long', enteredAt: enteredAt.toISOString(), breakoutLevel: round(breakoutLevel), entryPrice: round(entryPrice), atr14: round(atr14), initialStop: round(initialStop), profitTarget: round(entryPrice + (2 * riskPerUnit)), riskPerUnit: round(riskPerUnit), rewardRiskRatio: 2, invalidation: 'initial_stop_reached', maximumHoldingSessions: BREAKOUT_MOMENTUM_MAX_HOLDING_SESSIONS, sameBarAmbiguity: 'stop_first', gapRule: DEFINITION.gapRule, missingOrStaleEvidence: 'fail_closed_no_policy_exit', manualEmergencyClose: 'allowed_but_non_policy_compliant_and_excluded_from_cohort_minimum', partialExits: false, trailingStops: false, discretionaryChanges: false, deterministic: true, paperTradingOnly: true, liveTradingApproved: false, strategyFingerprint: input.strategyFingerprint ?? null }
  return Object.freeze({ ...core, fingerprint: fingerprint(core) })
}

export function evaluateBreakoutMomentumExitPolicy({ policy, bar = {}, sessionsHeld = 0 } = {}) {
  const expected = fingerprint(Object.fromEntries(Object.entries(policy ?? {}).filter(([key]) => key !== 'fingerprint')))
  if (policy?.version !== BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION || policy.fingerprint !== expected) return { action: 'BLOCKED', reason: 'exit_policy_invalid', paperTradingOnly: true }
  const [open, high, low, close] = [bar.open, bar.high, bar.low, bar.close].map(Number)
  if (String(bar.freshness ?? '').toUpperCase() !== 'FRESH' || [open, high, low, close].some((value) => !positive(value))) return { action: 'NO_ACTION', reason: 'missing_or_stale_market_evidence', paperTradingOnly: true }
  if (open <= policy.initialStop) return { action: 'EXIT_FULL', reason: 'stop_gap', exitPrice: open, conservative: true, paperTradingOnly: true }
  if (open >= policy.profitTarget) return { action: 'EXIT_FULL', reason: 'target_gap', exitPrice: policy.profitTarget, conservative: true, paperTradingOnly: true }
  const stopTouched = low <= policy.initialStop; const targetTouched = high >= policy.profitTarget
  if (stopTouched) return { action: 'EXIT_FULL', reason: targetTouched ? 'same_bar_stop_target_stop_first' : 'initial_stop', exitPrice: policy.initialStop, conservative: true, paperTradingOnly: true }
  if (targetTouched) return { action: 'EXIT_FULL', reason: 'profit_target', exitPrice: policy.profitTarget, conservative: true, paperTradingOnly: true }
  if (Number(sessionsHeld) >= BREAKOUT_MOMENTUM_MAX_HOLDING_SESSIONS) return { action: 'EXIT_FULL', reason: 'maximum_holding_period', exitPrice: close, conservative: true, paperTradingOnly: true }
  return { action: 'HOLD', reason: 'no_exit_condition_met', paperTradingOnly: true }
}