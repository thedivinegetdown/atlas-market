import { MARKET_REGIME_ENGINE_VERSION } from './regimeTypes.js'

export function createRegimeReadModel({ symbol, timeframe, classification, builtInput }) {
  const acceptedTimes = builtInput.inputCoverage.available
    .map((name) => builtInput.provenance[name]?.observedAt)
    .filter(Boolean)
    .sort()
  const freshness = builtInput.inputCoverage.stale.length > 0
    ? 'STALE'
    : builtInput.inputCoverage.unknownFreshness.length > 0 || acceptedTimes.length === 0 ? 'UNKNOWN' : 'FRESH'
  return {
    symbol,
    timeframe,
    asOf: acceptedTimes.at(-1) ?? null,
    freshness,
    classification: {
      trendRegime: classification.trendRegime,
      volatilityRegime: classification.volatilityRegime,
      riskRegime: classification.riskRegime,
      confidence: classification.confidence,
      status: classification.status,
      reasons: classification.reasons,
    },
    inputCoverage: builtInput.inputCoverage,
    provenance: builtInput.provenance,
    warnings: builtInput.warnings,
    engineVersion: classification.engineVersion ?? MARKET_REGIME_ENGINE_VERSION,
    paperTrading: true,
    advisoryOnly: true,
  }
}
