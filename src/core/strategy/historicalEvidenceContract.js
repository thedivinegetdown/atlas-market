// This contract describes capability, not caller-attested permission to execute.
// No audited historical entry-to-exit adapter exists at this version.
export const HISTORICAL_EVIDENCE_VERSION = 'historical-evidence-v1'
export const HISTORICAL_CAPABILITY_BLOCKERS = Object.freeze([
  'FROZEN_HISTORICAL_STRATEGY_POLICY_ADAPTER_UNAVAILABLE',
  'POINT_IN_TIME_CONTEXT_UNAVAILABLE',
  'EXECUTABLE_SESSION_TIMESTAMPS_UNAVAILABLE',
  'IMMUTABLE_MARKET_DATA_VINTAGE_UNAVAILABLE',
  'POINT_IN_TIME_UNIVERSE_UNAVAILABLE',
  'CORPORATE_ACTION_ACCOUNTING_UNAVAILABLE',
  'FROZEN_HISTORICAL_COST_MODEL_UNAVAILABLE',
])

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}

// Deterministic content checksum, following the existing policy fingerprints.
// It is not a credential, signature, or proof of provider authenticity.
export function historicalContentFingerprint(value) {
  const source = JSON.stringify(stable(value))
  return `historical-v1-${Array.from({ length: 8 }, (_, seed) => {
    let hash = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0
    for (let index = 0; index < source.length; index += 1) {
      hash = Math.imul(hash ^ (source.charCodeAt(index) + seed), 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')}`
}

export function historicalEvidenceUnavailable() {
  return {
    version: HISTORICAL_EVIDENCE_VERSION,
    status: 'UNAVAILABLE',
    blockers: [...HISTORICAL_CAPABILITY_BLOCKERS],
    strategyPolicyFingerprint: null,
    dataFingerprint: null,
    universeFingerprint: null,
    configurationFingerprint: null,
    signalTimestamp: null,
    executionTimestamp: null,
    executionPrice: null,
    outcomeSource: null,
    costs: null,
    paperTradingOnly: true,
    liveTradingApproved: false,
  }
}
