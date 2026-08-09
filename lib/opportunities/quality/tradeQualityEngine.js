import { calculateQualityConfidence } from './calculateQualityConfidence.js'
import { normalizeTradeCandidate } from './normalizeTradeCandidate.js'
import {
  scoreLiquidity, scoreMomentum, scoreRegimeFit, scoreRelativeStrength, scoreRiskReward,
  scoreStrategySuitability, scoreTrend, scoreVolume, scoreVolatility,
} from './scoreTradeQualityDimensions.js'
import { DEFAULT_TRADE_QUALITY_CONFIG } from './tradeQualityConfig.js'
import { TRADE_QUALITY_BANDS, TRADE_QUALITY_ENGINE_VERSION, TRADE_QUALITY_STATUSES } from './tradeQualityTypes.js'

const CORE_DIMENSIONS = new Set(['regimeFit', 'strategySuitability', 'liquidity', 'riskReward'])

function band(score) {
  if (score == null) return TRADE_QUALITY_BANDS.UNKNOWN
  if (score >= 90) return TRADE_QUALITY_BANDS.EXCEPTIONAL
  if (score >= 80) return TRADE_QUALITY_BANDS.STRONG
  if (score >= 70) return TRADE_QUALITY_BANDS.QUALIFIED
  if (score >= 55) return TRADE_QUALITY_BANDS.WATCH
  return TRADE_QUALITY_BANDS.WEAK
}

function selectSuitability(strategySuitability, strategyId) {
  return strategySuitability?.strategies?.find((item) => item.strategyId === strategyId) ?? null
}

export function scoreTradeQuality({ candidate: input = {}, regime = {}, strategySuitability = {}, marketContext = {}, riskContext = {} } = {}, options = {}) {
  const startedAt = Date.now()
  const config = options.config ?? DEFAULT_TRADE_QUALITY_CONFIG
  const candidate = normalizeTradeCandidate(input)
  const strategy = selectSuitability(strategySuitability, candidate.strategyId)
  const scored = [
    scoreRegimeFit(candidate, regime), scoreStrategySuitability(strategy), scoreTrend(candidate), scoreMomentum(candidate),
    scoreRelativeStrength(candidate, config), scoreVolume(candidate, config), scoreVolatility(candidate),
    scoreLiquidity(candidate, config), scoreRiskReward(candidate, config),
  ].filter(Boolean)
  const available = scored.map((item) => item.name)
  const missingInputs = Object.keys(config.weights).filter((name) => !available.includes(name))
  const totalWeight = Object.values(config.weights).reduce((sum, value) => sum + value, 0)
  const availableWeight = scored.reduce((sum, item) => sum + config.weights[item.name], 0)
  const coverage = Math.round((availableWeight / totalWeight) * 100)
  const coreCount = available.filter((name) => CORE_DIMENSIONS.has(name)).length
  const blockingReasons = [...candidate.hardRejectionReasons]
  if (strategy?.decision === 'DISABLED') blockingReasons.push('Approved strategy suitability is disabled')
  if (strategy?.blockingReasons?.length) blockingReasons.push(...strategy.blockingReasons)
  const liquidity = scored.find((item) => item.name === 'liquidity')
  if (liquidity?.quality === 0) blockingReasons.push('Liquidity requirement failed')
  const regimeStatus = regime.classification?.status ?? 'INSUFFICIENT_DATA'
  const stale = candidate.stale || regime.freshness === 'STALE' || (regime.inputCoverage?.stale?.length ?? 0) > 0
  if (stale) blockingReasons.push('Market evidence is stale')
  if (regimeStatus === 'INVALID_INPUT') blockingReasons.push('Market regime input is invalid')
  const insufficient = coverage < config.minimumCoverage || coreCount < config.minimumCoreDimensions || ['INVALID_INPUT', 'INSUFFICIENT_DATA'].includes(regimeStatus)
  let numericScore = availableWeight ? Math.round(scored.reduce((sum, item) => sum + item.quality * config.weights[item.name], 0) / availableWeight) : null
  if (numericScore != null) {
    if (stale || regimeStatus === 'INVALID_INPUT') numericScore = Math.min(numericScore, config.caps.staleOrInvalidRegime)
    if (regimeStatus === 'PARTIAL') numericScore = Math.min(numericScore, config.caps.partialRegime)
    if (strategy?.decision === 'DISABLED') numericScore = Math.min(numericScore, config.caps.disabledStrategy)
    if (liquidity?.quality === 0) numericScore = Math.min(numericScore, config.caps.failedLiquidity)
    if (blockingReasons.length) numericScore = Math.min(numericScore, config.caps.blockingPrerequisite)
  }
  const score = insufficient ? null : numericScore
  const status = regimeStatus === 'INVALID_INPUT' ? TRADE_QUALITY_STATUSES.INVALID_INPUT : insufficient ? TRADE_QUALITY_STATUSES.INSUFFICIENT_DATA : missingInputs.length ? TRADE_QUALITY_STATUSES.PARTIAL : TRADE_QUALITY_STATUSES.COMPLETE
  const freshness = stale ? 'STALE' : (regime.freshness ?? marketContext.freshness ?? 'UNKNOWN')
  const confidence = calculateQualityConfidence({ coverage, freshness, regimeStatus, blockerCount: blockingReasons.length })
  const dimensions = Object.fromEntries(Object.keys(config.weights).map((name) => {
    const item = scored.find((entry) => entry.name === name)
    return [name, item ? Math.round(item.quality * config.weights[name] / 100) : null]
  }))
  const result = {
    engineVersion: TRADE_QUALITY_ENGINE_VERSION,
    opportunityId: candidate.opportunityId,
    symbol: candidate.symbol,
    strategyId: candidate.strategyId,
    asOf: candidate.asOf,
    score,
    band: band(score),
    confidence,
    status,
    evidenceCoverage: coverage,
    dimensions,
    reasons: scored.map((item) => item.reason),
    blockingReasons: [...new Set(blockingReasons)],
    missingInputs,
    freshness,
    boundaries: { paperTradingOnly: true, advisoryOnly: true, automaticActivation: false, scannerRankingUnchanged: true },
  }
  options.logger?.info?.('trade quality evaluated', { engineVersion: result.engineVersion, band: result.band, status: result.status, confidence, missingInputCount: missingInputs.length, blockerCount: result.blockingReasons.length, durationMs: Date.now() - startedAt })
  void riskContext
  return result
}
