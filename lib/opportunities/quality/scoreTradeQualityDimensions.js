function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function dimension(name, quality, reason) {
  return { name, quality: clamp(quality), reason }
}

export function scoreRegimeFit(candidate, regime) {
  const trend = regime?.classification?.trendRegime
  if (!trend || trend === 'UNKNOWN') return null
  const bullish = ['BULL', 'STRONG_BULL'].includes(trend)
  const bearish = ['BEAR', 'STRONG_BEAR'].includes(trend)
  const direction = candidate.direction
  if (direction === 'neutral') return dimension('regimeFit', trend === 'RANGE' ? 100 : 55, `${trend} regime has limited direction evidence`)
  const aligned = (direction === 'bullish' || direction === 'long') ? bullish : (direction === 'bearish' || direction === 'short') && bearish
  return dimension('regimeFit', aligned ? 100 : trend === 'RANGE' ? 55 : 15, `${trend} regime is ${aligned ? '' : 'not '}aligned with ${direction} direction`)
}

export function scoreStrategySuitability(strategy) {
  if (!strategy?.decision) return null
  const quality = { ENABLED: 100, CONDITIONAL: 65, DISABLED: 0, UNKNOWN: 0 }[strategy.decision] ?? 0
  return dimension('strategySuitability', quality, `Strategy suitability is ${strategy.decision}`)
}

export function scoreTrend(candidate) {
  return candidate.evidence.trendScore == null ? null : dimension('trend', candidate.evidence.trendScore, `Trend evidence is ${clamp(candidate.evidence.trendScore)}`)
}

export function scoreMomentum(candidate) {
  return candidate.evidence.momentumScore == null ? null : dimension('momentum', candidate.evidence.momentumScore, `Momentum evidence is ${clamp(candidate.evidence.momentumScore)}`)
}

export function scoreRelativeStrength(candidate, config) {
  const value = candidate.evidence.relativeStrength
  if (value == null) return null
  const quality = value >= config.thresholds.relativeStrengthStrong ? 100 : value >= config.thresholds.relativeStrengthPositive ? 75 : value >= -5 ? 45 : 15
  return dimension('relativeStrength', quality, `Relative strength is ${value}`)
}

export function scoreVolume(candidate, config) {
  const value = candidate.evidence.relativeVolume
  if (value == null) return null
  const quality = value >= config.thresholds.relativeVolumeStrong ? 100 : value >= config.thresholds.relativeVolumeConfirmed ? 75 : value >= 0.75 ? 45 : 20
  return dimension('volume', quality, `Relative volume is ${value}`)
}

export function scoreVolatility(candidate) {
  const status = String(candidate.volatilitySummary?.status ?? '').toLowerCase()
  if (status) return dimension('volatility', { healthy: 100, normal: 90, elevated: 65, high: 45, extreme: 10 }[status] ?? 50, `Volatility status is ${status}`)
  const percentile = candidate.evidence.atrPercentile
  if (percentile == null) return null
  const quality = percentile >= 20 && percentile <= 80 ? 90 : percentile > 90 ? 35 : 60
  return dimension('volatility', quality, `ATR percentile is ${percentile}`)
}

export function scoreLiquidity(candidate, config) {
  const status = String(candidate.liquiditySummary?.status ?? '').toLowerCase()
  const spread = candidate.evidence.spreadPct
  if (!status && spread == null) return null
  const failed = ['thin', 'stressed', 'failed'].includes(status) || (spread != null && spread > config.thresholds.spreadMaximumPct)
  return dimension('liquidity', failed ? 0 : status === 'healthy' || status === 'deep' ? 100 : 70, failed ? 'Liquidity requirement failed' : 'Liquidity evidence is acceptable')
}

export function scoreRiskReward(candidate, config) {
  const value = candidate.evidence.rewardRiskRatio
  if (value == null || value <= 0) return null
  const quality = value >= config.thresholds.riskRewardStrong ? 100 : value >= config.thresholds.riskRewardAcceptable ? 80 : value >= config.thresholds.riskRewardMinimum ? 50 : 15
  return dimension('riskReward', quality, `Reward-to-risk ratio is ${value}`)
}
