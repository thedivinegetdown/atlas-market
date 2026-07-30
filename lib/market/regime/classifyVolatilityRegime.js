import { VOLATILITY_REGIMES } from './regimeTypes.js'

export function classifyVolatilityRegime(metrics, config) {
  const values = []
  const evidence = []
  if (metrics.atrPercentile !== undefined) { values.push(Math.max(0, Math.min(100, metrics.atrPercentile))); evidence.push({ reason: metrics.atrPercentile >= config.highAtrPercentile ? 'ATR percentile is elevated' : metrics.atrPercentile <= config.lowAtrPercentile ? 'ATR percentile is subdued' : 'ATR percentile is normal' }) }
  if (metrics.atrPct !== undefined) { const score = metrics.atrPct >= config.highAtrPct ? 85 : metrics.atrPct <= config.lowAtrPct ? 15 : 50; values.push(score); evidence.push({ reason: score >= 70 ? 'Normalized ATR is elevated' : score <= 30 ? 'Normalized ATR is subdued' : 'Normalized ATR is normal' }) }
  if (metrics.volatilityIndex !== undefined) { const score = metrics.volatilityIndex >= config.highVix ? 85 : metrics.volatilityIndex <= config.lowVix ? 15 : 50; values.push(score); evidence.push({ reason: score >= 70 ? 'Volatility index is elevated' : score <= 30 ? 'Volatility index is subdued' : 'Volatility index is normal' }) }
  if (values.length < config.minimumEvidence) return { regime: VOLATILITY_REGIMES.UNKNOWN, score: 0, evidenceCount: values.length, evidence }
  const score = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const regime = score >= config.highScore ? VOLATILITY_REGIMES.HIGH : score <= config.lowScore ? VOLATILITY_REGIMES.LOW : VOLATILITY_REGIMES.NORMAL
  return { regime, score, evidenceCount: values.length, evidence }
}
