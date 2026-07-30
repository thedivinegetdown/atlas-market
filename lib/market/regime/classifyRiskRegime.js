import { RISK_REGIMES } from './regimeTypes.js'

export function classifyRiskRegime(metrics, trendResult, config) {
  const values = []
  const evidence = []
  const add = (value, reason) => { values.push(value); evidence.push({ reason }) }
  if (metrics.marketBreadthPct !== undefined) add(metrics.marketBreadthPct >= config.strongBreadthPct ? 85 : metrics.marketBreadthPct >= config.positiveBreadthPct ? 70 : metrics.marketBreadthPct <= config.weakBreadthPct ? 15 : metrics.marketBreadthPct <= config.negativeBreadthPct ? 30 : 50, metrics.marketBreadthPct >= config.positiveBreadthPct ? 'Market breadth is positive' : metrics.marketBreadthPct <= config.negativeBreadthPct ? 'Market breadth is negative' : 'Market breadth is mixed')
  if (metrics.volatilityIndex !== undefined) add(metrics.volatilityIndex >= config.highVix ? 20 : metrics.volatilityIndex <= config.lowVix ? 80 : 50, metrics.volatilityIndex >= config.highVix ? 'Volatility conditions favor risk-off behavior' : metrics.volatilityIndex <= config.lowVix ? 'Volatility conditions support risk-on behavior' : 'Volatility conditions are neutral')
  if (metrics.benchmarkAboveLongAverage !== undefined) add(metrics.benchmarkAboveLongAverage ? 75 : 25, metrics.benchmarkAboveLongAverage ? 'Benchmark is above its long-term moving average' : 'Benchmark is below its long-term moving average')
  if (metrics.benchmarkChangePct !== undefined) add(metrics.benchmarkChangePct > 0 ? 65 : metrics.benchmarkChangePct < 0 ? 35 : 50, metrics.benchmarkChangePct > 0 ? 'Benchmark trend is positive' : metrics.benchmarkChangePct < 0 ? 'Benchmark trend is negative' : 'Benchmark trend is flat')
  if (metrics.relativeStrengthPct !== undefined) add(metrics.relativeStrengthPct >= config.relativeStrengthPct ? 70 : metrics.relativeStrengthPct <= -config.relativeStrengthPct ? 30 : 50, metrics.relativeStrengthPct > 0 ? 'Relative strength supports risk-on conditions' : metrics.relativeStrengthPct < 0 ? 'Relative strength supports risk-off conditions' : 'Relative strength is neutral')
  if (trendResult.regime !== 'UNKNOWN') add(Math.max(0, Math.min(100, 50 + trendResult.score / 2)), 'Trend regime contributes to the risk environment')
  if (values.length < config.minimumEvidence) return { regime: RISK_REGIMES.UNKNOWN, score: 0, evidenceCount: values.length, evidence }
  const score = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const regime = score >= config.riskOnScore ? RISK_REGIMES.ON : score <= config.riskOffScore ? RISK_REGIMES.OFF : RISK_REGIMES.NEUTRAL
  return { regime, score, evidenceCount: values.length, evidence }
}
