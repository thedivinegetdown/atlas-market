export const RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION = 'range-mean-reversion-exit-v1.0.0'
export const RANGE_MEAN_REVERSION_MAX_HOLDING_SESSIONS = 10

const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
const round = (value) => Number(Number(value).toFixed(6))
const stable = (value) => value && typeof value === 'object' ? Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: stable(value[key]) }), {}) : value
const fingerprint = (value) => Array.from({ length: 8 }, (_, seed) => Array.from(JSON.stringify(stable(value))).reduce((hash, character) => Math.imul(hash ^ (character.charCodeAt(0) + seed), 0x01000193) >>> 0, 0x811c9dc5).toString(16).padStart(8, '0')).join('')
const DEFINITION = Object.freeze({ version: RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION, stop: 'max(prior20_low-(0.5*atr14),entry_price-(1.5*atr14))', target: 'entry_time_sma20', minimumRewardRiskRatio: 1.25, maximumHoldingSessions: 10, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target', trailingStops: false, partialExits: false, paperTradingOnly: true, liveTradingApproved: false })
export const RANGE_MEAN_REVERSION_EXIT_POLICY_DEFINITION_FINGERPRINT = fingerprint(DEFINITION)

export function createRangeMeanReversionExitPolicy(input = {}) {
  const entryPrice = Number(input.entryPrice), prior20Low = Number(input.prior20Low), sma20 = Number(input.sma20), atr14 = Number(input.atr14), enteredAt = new Date(input.enteredAt ?? input.evidenceTimestamp)
  if (input.strategyId !== 'range-mean-reversion-v1' || !String(input.strategyVersion ?? '').trim()) throw new Error('range-mean-reversion-v1 strategy identity and version are required')
  if (![entryPrice, prior20Low, sma20, atr14].every(positive) || Number.isNaN(enteredAt.getTime())) throw new Error('complete entry, range low, SMA20, ATR14, and timestamp evidence is required')
  const initialStop = Math.max(prior20Low - (0.5 * atr14), entryPrice - (1.5 * atr14)), riskPerUnit = entryPrice - initialStop, rewardRiskRatio = (sma20 - entryPrice) / riskPerUnit
  if (!(initialStop < entryPrice) || !(sma20 > entryPrice) || rewardRiskRatio < 1.25) throw new Error('range mean reversion stop or target geometry is invalid')
  const core = { version: RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION, definitionFingerprint: RANGE_MEAN_REVERSION_EXIT_POLICY_DEFINITION_FINGERPRINT, strategyId: input.strategyId, strategyVersion: input.strategyVersion, positionSide: 'long', enteredAt: enteredAt.toISOString(), prior20Low: round(prior20Low), SMA20: round(sma20), atr14: round(atr14), entryPrice: round(entryPrice), initialStop: round(initialStop), profitTarget: round(sma20), riskPerUnit: round(riskPerUnit), rewardRiskRatio: round(rewardRiskRatio), invalidation: 'initial_stop_reached', maximumHoldingSessions: RANGE_MEAN_REVERSION_MAX_HOLDING_SESSIONS, sameBarAmbiguity: 'stop_first', gapRule: DEFINITION.gapRule, missingOrStaleEvidence: 'fail_closed_no_policy_exit', manualEmergencyClose: 'allowed_but_non_policy_compliant_and_excluded_from_cohort_minimum', partialExits: false, trailingStops: false, discretionaryChanges: false, deterministic: true, paperTradingOnly: true, liveTradingApproved: false, strategyFingerprint: input.strategyFingerprint ?? null }
  return Object.freeze({ ...core, fingerprint: fingerprint(core) })
}

export function evaluateRangeMeanReversionExitPolicy({ policy, bar = {}, sessionsHeld = 0 } = {}) {
  const expected = fingerprint(Object.fromEntries(Object.entries(policy ?? {}).filter(([key]) => key !== 'fingerprint')))
  if (policy?.version !== RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION || policy.fingerprint !== expected) return { action: 'BLOCKED', reason: 'exit_policy_invalid', paperTradingOnly: true }
  const [open, high, low, close] = [bar.open, bar.high, bar.low, bar.close].map(Number)
  if (String(bar.freshness ?? '').toUpperCase() !== 'FRESH' || [open, high, low, close].some((value) => !positive(value))) return { action: 'NO_ACTION', reason: 'missing_or_stale_market_evidence', paperTradingOnly: true }
  if (open <= policy.initialStop) return { action: 'EXIT_FULL', reason: 'stop_gap', exitPrice: open, conservative: true, paperTradingOnly: true }
  if (open >= policy.profitTarget) return { action: 'EXIT_FULL', reason: 'target_gap', exitPrice: policy.profitTarget, conservative: true, paperTradingOnly: true }
  const stopTouched = low <= policy.initialStop, targetTouched = high >= policy.profitTarget
  if (stopTouched) return { action: 'EXIT_FULL', reason: targetTouched ? 'same_bar_stop_target_stop_first' : 'initial_stop', exitPrice: policy.initialStop, conservative: true, paperTradingOnly: true }
  if (targetTouched) return { action: 'EXIT_FULL', reason: 'profit_target', exitPrice: policy.profitTarget, conservative: true, paperTradingOnly: true }
  if (Number(sessionsHeld) >= RANGE_MEAN_REVERSION_MAX_HOLDING_SESSIONS) return { action: 'EXIT_FULL', reason: 'maximum_holding_period', exitPrice: close, conservative: true, paperTradingOnly: true }
  return { action: 'HOLD', reason: 'no_exit_condition_met', paperTradingOnly: true }
}