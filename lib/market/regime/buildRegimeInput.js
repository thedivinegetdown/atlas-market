import { REGIME_INPUT_ALIASES, REGIME_INPUT_NAMES } from './regimeOrchestrationConfig.js'
import { validateRegimeFreshness } from './validateRegimeFreshness.js'
import { validateRegimeTimeframe } from './validateRegimeTimeframes.js'

function canonicalName(name) {
  return REGIME_INPUT_NAMES.includes(name) ? name : REGIME_INPUT_ALIASES[name]
}

function normalizeValue(name, alias, raw) {
  if (name === 'benchmarkAboveLongAverage') return typeof raw === 'boolean' ? raw : undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  if (alias === 'atrRatio' || alias === 'breadthRatio') return Number((value * 100).toFixed(8))
  return value
}

export function buildRegimeInput({ observations = {}, symbol, timeframe = '1D' } = {}, options = {}) {
  const metrics = {}
  const provenance = {}
  const coverage = { available: [], missing: [], stale: [], invalid: [], incompatible: [], unknownFreshness: [] }
  const warnings = []

  for (const [alias, observationValue] of Object.entries(observations)) {
    const name = canonicalName(alias)
    if (!name) continue
    const observation = observationValue && typeof observationValue === 'object' && 'value' in observationValue
      ? observationValue
      : { value: observationValue }
    const value = normalizeValue(name, alias, observation.value)
    if (value === undefined) {
      coverage.invalid.push(name)
      continue
    }
    const timeframeResult = validateRegimeTimeframe(name, observation.timeframe, timeframe)
    const freshness = validateRegimeFreshness(observation.observedAt, {
      now: options.now,
      timeframe: timeframeResult.timeframe,
      config: options.freshness,
    })
    provenance[name] = {
      source: observation.source ?? 'unknown',
      symbol: observation.symbol ?? symbol ?? null,
      timeframe: timeframeResult.timeframe,
      observedAt: observation.observedAt ?? null,
      receivedAt: observation.receivedAt ?? null,
      freshness,
      derivation: observation.derivation ?? 'provider-supplied',
    }
    if (!timeframeResult.compatible) {
      coverage.incompatible.push(name)
      warnings.push(timeframeResult.warning)
      continue
    }
    if (freshness === 'STALE') {
      coverage.stale.push(name)
      warnings.push(`${name} is stale`)
      continue
    }
    if (freshness === 'UNKNOWN') {
      coverage.unknownFreshness.push(name)
      warnings.push(`${name} freshness is unknown`)
      continue
    }
    metrics[name] = value
    coverage.available.push(name)
  }
  coverage.missing = REGIME_INPUT_NAMES.filter((name) => metrics[name] === undefined)
  return { metrics, provenance, inputCoverage: coverage, warnings }
}
