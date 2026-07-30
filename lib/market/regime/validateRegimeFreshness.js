import { DEFAULT_REGIME_ORCHESTRATION_CONFIG, REGIME_FRESHNESS } from './regimeOrchestrationConfig.js'

export function validateRegimeFreshness(observedAt, { now = new Date(), timeframe, config = {} } = {}) {
  const rules = { ...DEFAULT_REGIME_ORCHESTRATION_CONFIG, ...config }
  const observedTime = new Date(observedAt).getTime()
  const nowTime = new Date(now).getTime()
  if (!observedAt || !Number.isFinite(observedTime) || !Number.isFinite(nowTime)) return REGIME_FRESHNESS.UNKNOWN
  const maxAgeMs = timeframe === 'REALTIME' ? rules.realtimeMaxAgeMs : rules.dailyMaxAgeMs
  return nowTime - observedTime <= maxAgeMs && nowTime - observedTime >= 0
    ? REGIME_FRESHNESS.FRESH
    : REGIME_FRESHNESS.STALE
}
