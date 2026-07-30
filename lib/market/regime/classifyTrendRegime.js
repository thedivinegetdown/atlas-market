import { TREND_REGIMES } from './regimeTypes.js'

function pctDifference(value, baseline) { return baseline > 0 ? ((value - baseline) / baseline) * 100 : 0 }

export function classifyTrendRegime(metrics, config) {
  let score = 0
  let evidenceCount = 0
  const evidence = []
  const add = (points, reason) => { score += points; evidenceCount += 1; evidence.push({ points, reason }) }
  if (metrics.price > 0 && metrics.longMovingAverage > 0) {
    const separation = pctDifference(metrics.price, metrics.longMovingAverage)
    add(separation >= config.strongMaSeparationPct ? 22 : separation > 0 ? 14 : separation <= -config.strongMaSeparationPct ? -22 : -14, separation > 0 ? 'Price is above the long-term moving average' : 'Price is below the long-term moving average')
  }
  if (metrics.shortMovingAverage > 0 && metrics.longMovingAverage > 0) add(metrics.shortMovingAverage > metrics.longMovingAverage ? 18 : metrics.shortMovingAverage < metrics.longMovingAverage ? -18 : 0, metrics.shortMovingAverage > metrics.longMovingAverage ? 'Short-term moving average is above the long-term moving average' : metrics.shortMovingAverage < metrics.longMovingAverage ? 'Short-term moving average is below the long-term moving average' : 'Short- and long-term moving averages are aligned')
  if (metrics.mediumMovingAverage > 0 && metrics.longMovingAverage > 0) add(metrics.mediumMovingAverage > metrics.longMovingAverage ? 12 : metrics.mediumMovingAverage < metrics.longMovingAverage ? -12 : 0, metrics.mediumMovingAverage > metrics.longMovingAverage ? 'Medium-term moving average is above the long-term moving average' : metrics.mediumMovingAverage < metrics.longMovingAverage ? 'Medium-term moving average is below the long-term moving average' : 'Medium- and long-term moving averages are aligned')
  if (metrics.movingAverageSlopePct !== undefined) {
    const slope = metrics.movingAverageSlopePct
    add(slope >= config.strongSlopePct ? 18 : slope >= config.slopePct ? 12 : slope <= -config.strongSlopePct ? -18 : slope <= -config.slopePct ? -12 : 0, slope > 0 ? 'Moving-average slope is positive' : slope < 0 ? 'Moving-average slope is negative' : 'Moving-average slope is flat')
  }
  if (metrics.relativeStrengthPct !== undefined) add(metrics.relativeStrengthPct >= config.relativeStrengthPct ? 10 : metrics.relativeStrengthPct <= -config.relativeStrengthPct ? -10 : 0, metrics.relativeStrengthPct > 0 ? 'Relative strength is positive' : metrics.relativeStrengthPct < 0 ? 'Relative strength is negative' : 'Relative strength is neutral')
  if (metrics.adx !== undefined && metrics.adx >= config.adxTrend && score !== 0) {
    const strength = metrics.adx >= config.adxStrongTrend ? 12 : 7
    add(score > 0 ? strength : -strength, metrics.adx >= config.adxStrongTrend ? 'ADX confirms a strong directional trend' : 'ADX confirms a directional trend')
  }
  score = Math.max(-100, Math.min(100, score))
  if (evidenceCount < config.minimumEvidence) return { regime: TREND_REGIMES.UNKNOWN, score, evidenceCount, evidence }
  const regime = score >= config.strongBullScore ? TREND_REGIMES.STRONG_BULL : score >= config.bullScore ? TREND_REGIMES.BULL : score <= config.strongBearScore ? TREND_REGIMES.STRONG_BEAR : score <= config.bearScore ? TREND_REGIMES.BEAR : TREND_REGIMES.RANGE
  return { regime, score, evidenceCount, evidence }
}
