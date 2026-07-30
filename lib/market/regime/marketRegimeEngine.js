import { createRegimeConfig } from './regimeConfig.js'
import { normalizeRegimeInputs } from './normalizeRegimeInputs.js'
import { classifyTrendRegime } from './classifyTrendRegime.js'
import { classifyVolatilityRegime } from './classifyVolatilityRegime.js'
import { classifyRiskRegime } from './classifyRiskRegime.js'
import { calculateRegimeConfidence } from './calculateRegimeConfidence.js'
import { buildRegimeReasons } from './buildRegimeReasons.js'
import { MARKET_REGIME_ENGINE_VERSION, REGIME_STATUSES } from './regimeTypes.js'
import { eventBus as defaultEventBus } from '../../core/eventBus.js'

export const MARKET_REGIME_CLASSIFIED_EVENT = 'market.regime.classified'

function determineStatus({ invalidInputs, trend, volatility, risk }) {
  if (invalidInputs.length) return REGIME_STATUSES.INVALID
  const knownCount = [trend, volatility, risk].filter((result) => result.regime !== 'UNKNOWN').length
  if (knownCount === 0) return REGIME_STATUSES.INSUFFICIENT
  return knownCount === 3 ? REGIME_STATUSES.COMPLETE : REGIME_STATUSES.PARTIAL
}

function normalizedMetrics(metrics, trend, volatility, risk) {
  return {
    ...metrics,
    trendScore: trend.score,
    volatilityScore: volatility.score,
    riskScore: risk.score,
  }
}

export function classifyMarketRegime(input = {}, options = {}) {
  const config = createRegimeConfig(options.config)
  const normalized = normalizeRegimeInputs(input)
  const trend = classifyTrendRegime(normalized.metrics, config.trend)
  const volatility = classifyVolatilityRegime(normalized.metrics, config.volatility)
  const risk = classifyRiskRegime(normalized.metrics, trend, config.risk)
  const status = determineStatus({ invalidInputs: normalized.invalidInputs, trend, volatility, risk })
  const confidence = calculateRegimeConfidence({ trend, volatility, risk, missingInputs: normalized.missingInputs, invalidInputs: normalized.invalidInputs, status, config })
  const result = {
    eventType: MARKET_REGIME_CLASSIFIED_EVENT,
    trendRegime: trend.regime,
    volatilityRegime: volatility.regime,
    riskRegime: risk.regime,
    confidence,
    status,
    metrics: normalizedMetrics(normalized.metrics, trend, volatility, risk),
    reasons: buildRegimeReasons(trend, volatility, risk),
    missingInputs: normalized.missingInputs,
    invalidInputs: normalized.invalidInputs,
    engineVersion: MARKET_REGIME_ENGINE_VERSION,
    paperTrading: true,
    advisoryOnly: true,
  }
  if (options.timestamp !== undefined) result.evaluatedAt = new Date(options.timestamp).toISOString()
  const eventBus = options.eventBus ?? defaultEventBus
  if (options.emitEvent === true && eventBus?.emit) eventBus.emit(MARKET_REGIME_CLASSIFIED_EVENT, result)
  return result
}

export function createMarketRegimeEngine(options = {}) {
  return { classify(input, evaluationOptions = {}) { return classifyMarketRegime(input, { ...options, ...evaluationOptions }) } }
}
