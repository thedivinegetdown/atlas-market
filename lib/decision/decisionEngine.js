import { DECISION_ACTIONS, formatDecisionLabel } from './decisionActions.js'
import { createDecisionScorers } from './scorers.js'
import { roundPriceForAsset } from '../assets/index.js'

const defaultWeights = Object.freeze({
  trend: 0.2,
  momentum: 0.18,
  risk: 0.24,
  volatility: 0.12,
  liquidity: 0.12,
  portfolioExposure: 0.14,
})

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(numberValue(value, 50))))
}

function scoreToAction(score, riskScore, signal = {}) {
  const action = String(signal.action ?? '').toUpperCase()
  if (riskScore <= 25) return DECISION_ACTIONS.AVOID
  if ((action.includes('HOLD') || action.includes('NEUTRAL')) && score < 75) {
    return score >= 55 ? DECISION_ACTIONS.WATCH : DECISION_ACTIONS.NEUTRAL
  }
  if (score >= 85) return DECISION_ACTIONS.STRONG_BUY
  if (score >= 70) return DECISION_ACTIONS.BUY
  if (score >= 55) return DECISION_ACTIONS.WATCH
  if (score >= 45) return DECISION_ACTIONS.NEUTRAL
  if (score >= 30) return action.includes('SELL') ? DECISION_ACTIONS.SELL : DECISION_ACTIONS.REDUCE
  if (score >= 15) return DECISION_ACTIONS.SELL
  return DECISION_ACTIONS.STRONG_SELL
}

function topFactors(results, predicate) {
  return Object.values(results)
    .filter(predicate)
    .flatMap((result) => result.reasons.map((reason) => ({ reason, score: result.score })))
    .sort((left, right) => Math.abs(right.score - 50) - Math.abs(left.score - 50))
    .map((entry) => entry.reason)
    .slice(0, 5)
}

function buildConfidenceExplanation(score, confidence, warnings) {
  const direction = score >= 65 ? 'constructive' : score <= 40 ? 'defensive' : 'balanced'
  const warningText = warnings.length > 0 ? ` with ${warnings.length} active warning${warnings.length === 1 ? '' : 's'}` : ''
  return `Confidence is ${confidence}% because component scores are ${direction}${warningText}.`
}

function buildTradePlan({ quote = {}, risk = {}, assetProfile = {} }) {
  const assetType = assetProfile.assetType ?? quote.assetType ?? 'equity'
  const price = numberValue(quote.price)
  const stopDistance = numberValue(risk.stopDistance, price * 0.02)
  const stop = numberValue(risk.stopPrice, price - stopDistance)
  const target = numberValue(risk.targetPrice, price + (stopDistance * 2))
  const positionSize = numberValue(risk.positionSize || risk.adjustedQuantity || risk.requestedPositionSize, 0)
  const roundedStop = price > 0 ? roundPriceForAsset(stop, assetType) : 0
  const roundedTarget = price > 0 ? roundPriceForAsset(target, assetType) : 0
  const riskDistance = Math.abs(price - roundedStop)
  const rewardDistance = Math.abs(roundedTarget - price)

  return {
    recommendedPositionSize: positionSize,
    recommendedStop: roundedStop,
    recommendedTarget: roundedTarget,
    riskRewardRatio: riskDistance > 0 ? Number((rewardDistance / riskDistance).toFixed(2)) : 0,
  }
}

export function createDecisionEngine({ scorers = createDecisionScorers(), weights = defaultWeights, now = () => new Date() } = {}) {
  function evaluate(context = {}) {
    const scoreResults = {
      trend: scorers.trend.score(context),
      momentum: scorers.momentum.score(context),
      risk: scorers.risk.score(context),
      volatility: scorers.volatility.score(context),
      liquidity: scorers.liquidity.score(context),
      portfolioExposure: scorers.portfolioExposure.score(context),
    }
    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + numberValue(weight), 0) || 1
    const overallScore = clampScore(Object.entries(scoreResults).reduce((sum, [key, result]) => {
      return sum + (result.score * numberValue(weights[key]))
    }, 0) / totalWeight)
    const warnings = [...new Set(Object.values(scoreResults).flatMap((result) => result.warnings))]
    const signalConfidence = numberValue(context.signal?.confidence, 50)
    const confidence = clampScore((overallScore * 0.68) + (signalConfidence * 0.22) + ((100 - Math.min(100, warnings.length * 12)) * 0.1))
    const recommendedAction = scoreToAction(overallScore, scoreResults.risk.score, context.signal)
    const positiveFactors = topFactors(scoreResults, (result) => result.score >= 60)
    const negativeFactors = topFactors(scoreResults, (result) => result.score <= 45)
    const plan = buildTradePlan(context)

    return {
      overallDecision: formatDecisionLabel(recommendedAction),
      overallScore,
      confidence,
      riskScore: scoreResults.risk.score,
      trendScore: scoreResults.trend.score,
      momentumScore: scoreResults.momentum.score,
      volatilityScore: scoreResults.volatility.score,
      liquidityScore: scoreResults.liquidity.score,
      portfolioExposureScore: scoreResults.portfolioExposure.score,
      recommendedAction,
      ...plan,
      positiveFactors,
      negativeFactors,
      warnings,
      confidenceExplanation: buildConfidenceExplanation(overallScore, confidence, warnings),
      componentScores: scoreResults,
      timestamp: now().toISOString(),
    }
  }

  return { evaluate, weights }
}
