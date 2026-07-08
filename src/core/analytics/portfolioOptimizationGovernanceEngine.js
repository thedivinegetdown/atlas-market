import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const PORTFOLIO_OPTIMIZATION_GOVERNANCE_REVIEWED_EVENT = 'portfolio.optimizationGovernance.reviewed'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getPortfolioOptimization(input = {}) {
  return input.portfolioOptimization ?? input.optimization ?? {}
}

function getPortfolioRisk(input = {}) {
  return input.portfolioRisk ?? input.risk ?? {}
}

function getPortfolioCorrelation(input = {}) {
  return input.portfolioCorrelation ?? input.correlation ?? {}
}

function getPortfolioFactorExposure(input = {}) {
  return input.portfolioFactorExposure ?? input.factorExposure ?? {}
}

function getCapitalAllocation(input = {}) {
  return input.capitalAllocation ?? input.portfolioCapitalAllocation ?? {}
}

function getAiDecision(input = {}) {
  return input.aiDecision ?? input.decision ?? {}
}

function collectRecommendations(optimization = {}) {
  return [
    ...(optimization.riskReductionRecommendations ?? []),
    ...(optimization.diversificationRecommendations ?? []),
    ...(optimization.factorExposureAdjustmentRecommendations ?? []),
    ...(optimization.correlationReductionRecommendations ?? []),
    ...(optimization.capitalAllocationAdjustmentRecommendations ?? []),
    ...(optimization.strategyAllocationRecommendations ?? []),
  ]
}

function buildRecommendationApprovalReview(optimization = {}) {
  const recommendations = collectRecommendations(optimization)
  const unsafeRecommendations = recommendations.filter((item) => (
    item.paperTrading === false
    || item.liveOrders === true
    || item.recommendationOnly === false
  ))
  const highPriority = recommendations.filter((item) => item.priority === 'high').length
  const mediumPriority = recommendations.filter((item) => item.priority === 'medium').length
  const optimizationConfidenceScore = numberValue(optimization.optimizationConfidenceScore)
  const status = unsafeRecommendations.length > 0
    ? 'rejected'
    : highPriority > 0 || optimization.recommendationPriority === 'high'
      ? 'caution'
      : 'approved'

  return {
    status,
    totalRecommendations: recommendations.length,
    approvedRecommendations: recommendations.length - unsafeRecommendations.length,
    rejectedRecommendations: unsafeRecommendations.length,
    highPriority,
    mediumPriority,
    optimizationConfidenceScore: round(optimizationConfidenceScore),
    rationale: unsafeRecommendations.length > 0
      ? 'Recommendation package contains non-paper or executable action metadata.'
      : `Recommendation package is paper-only with ${highPriority} high-priority items.`,
  }
}

function buildRiskImpactReview(risk = {}) {
  const riskLevel = risk.summary?.riskLevel ?? 'unknown'
  const riskScore = numberValue(risk.summary?.riskScore)
  const openRiskPct = numberValue(risk.summary?.openRiskPct)
  const status = riskLevel === 'critical'
    ? 'rejected'
    : ['high', 'elevated'].includes(riskLevel) || openRiskPct > 2
      ? 'caution'
      : 'approved'

  return {
    status,
    riskLevel,
    riskScore: round(riskScore),
    openRiskPct: round(openRiskPct),
    rationale: status === 'approved'
      ? 'Portfolio risk permits recommendation review.'
      : `Portfolio risk is ${riskLevel}; operator review is required before recommendations influence decisions.`,
  }
}

function buildCorrelationImpactReview(correlation = {}) {
  const concentration = correlation.concentrationRiskFromCorrelatedAssets ?? {}
  const highCorrelationPairs = concentration.highCorrelationPairs ?? []
  const correlatedWeight = numberValue(concentration.correlatedWeight)
  const status = correlation.correlationRiskStatus === 'elevated' || correlatedWeight >= 45
    ? 'caution'
    : correlation.correlationRiskStatus === 'clear'
      ? 'approved'
      : 'caution'

  return {
    status,
    correlationRiskStatus: correlation.correlationRiskStatus ?? 'unknown',
    correlatedWeight: round(correlatedWeight),
    highCorrelationPairCount: highCorrelationPairs.length,
    rationale: status === 'approved'
      ? 'Correlation conditions are acceptable for recommendation review.'
      : 'Correlation conditions require operator review before optimization influence.',
  }
}

function buildFactorExposureImpactReview(factorExposure = {}) {
  const summary = factorExposure.factorConcentrationSummary ?? {}
  const elevatedFactors = summary.elevatedFactors ?? []
  const cautionFactors = summary.cautionFactors ?? []
  const status = factorExposure.factorRiskStatus === 'elevated' || elevatedFactors.length > 0
    ? 'caution'
    : factorExposure.factorRiskStatus === 'clear'
      ? 'approved'
      : 'caution'

  return {
    status,
    factorRiskStatus: factorExposure.factorRiskStatus ?? 'unknown',
    elevatedFactors: elevatedFactors.map((item) => item.factor),
    cautionFactors: cautionFactors.map((item) => item.factor),
    rationale: status === 'approved'
      ? 'Factor exposure conditions are acceptable for recommendation review.'
      : 'Factor exposure requires operator review before optimization influence.',
  }
}

function buildCapitalAllocationImpactReview(capitalAllocation = {}) {
  const allocationStatus = capitalAllocation.allocationStatus ?? 'unknown'
  const constrained = allocationStatus === 'constrained'
  const overweightSymbols = (capitalAllocation.allocation?.bySymbol ?? [])
    .filter((item) => item.allocationState === 'overweight')
    .map((item) => item.symbol)
  const status = constrained
    ? 'rejected'
    : allocationStatus === 'balanced' && overweightSymbols.length === 0
      ? 'approved'
      : 'caution'

  return {
    status,
    allocationStatus,
    availableCapital: round(capitalAllocation.capital?.availableCapital),
    overweightSymbols,
    rationale: status === 'approved'
      ? 'Capital allocation permits recommendation review.'
      : `Capital allocation is ${allocationStatus}; operator review is required.`,
  }
}

function buildAiDecisionReview(aiDecision = {}) {
  const finalDecision = aiDecision.finalDecision ?? 'unknown'
  const blockers = aiDecision.blockers ?? []
  const cautions = aiDecision.cautions ?? []
  const status = finalDecision === 'reject' || blockers.length > 0
    ? 'rejected'
    : finalDecision === 'caution' || cautions.length > 0
      ? 'caution'
      : 'approved'

  return {
    status,
    finalDecision,
    blockerCount: blockers.length,
    cautionCount: cautions.length,
    rationale: status === 'approved'
      ? 'AI decision context does not block governance review.'
      : 'AI decision context requires additional operator governance review.',
  }
}

function classifyOperatorAction({ recommendationApprovalReview, riskImpactReview, correlationImpactReview, factorExposureImpactReview, capitalAllocationImpactReview, aiDecisionReview }) {
  const reviews = [
    recommendationApprovalReview,
    riskImpactReview,
    correlationImpactReview,
    factorExposureImpactReview,
    capitalAllocationImpactReview,
    aiDecisionReview,
  ]
  if (reviews.some((review) => review.status === 'rejected')) {
    return {
      classification: 'manual_review_required',
      allowedToInfluenceAiDecision: false,
      allowedForOperatorAction: false,
      rationale: 'At least one governance review rejected the optimization package.',
    }
  }
  if (reviews.some((review) => review.status === 'caution')) {
    return {
      classification: 'operator_review_required',
      allowedToInfluenceAiDecision: false,
      allowedForOperatorAction: true,
      rationale: 'Optimization recommendations can be reviewed by an operator but should not influence AI decisions automatically.',
    }
  }
  return {
    classification: 'reviewed_recommendation_only',
    allowedToInfluenceAiDecision: true,
    allowedForOperatorAction: true,
    rationale: 'Governance review approved paper-only recommendations for downstream context.',
  }
}

function resolveGovernanceStatus(reviews = []) {
  if (reviews.some((review) => review.status === 'rejected')) return 'rejected'
  if (reviews.some((review) => review.status === 'caution')) return 'caution'
  return 'approved'
}

export function reviewPortfolioOptimizationGovernance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const portfolioOptimization = getPortfolioOptimization(input)
  const portfolioRisk = getPortfolioRisk(input)
  const portfolioCorrelation = getPortfolioCorrelation(input)
  const portfolioFactorExposure = getPortfolioFactorExposure(input)
  const capitalAllocation = getCapitalAllocation(input)
  const aiDecision = getAiDecision(input)
  const recommendationApprovalReview = buildRecommendationApprovalReview(portfolioOptimization)
  const riskImpactReview = buildRiskImpactReview(portfolioRisk)
  const correlationImpactReview = buildCorrelationImpactReview(portfolioCorrelation)
  const factorExposureImpactReview = buildFactorExposureImpactReview(portfolioFactorExposure)
  const capitalAllocationImpactReview = buildCapitalAllocationImpactReview(capitalAllocation)
  const aiDecisionReview = buildAiDecisionReview(aiDecision)
  const operatorActionClassification = classifyOperatorAction({
    recommendationApprovalReview,
    riskImpactReview,
    correlationImpactReview,
    factorExposureImpactReview,
    capitalAllocationImpactReview,
    aiDecisionReview,
  })
  const governanceStatus = resolveGovernanceStatus([
    recommendationApprovalReview,
    riskImpactReview,
    correlationImpactReview,
    factorExposureImpactReview,
    capitalAllocationImpactReview,
    aiDecisionReview,
  ])
  const result = {
    eventType: PORTFOLIO_OPTIMIZATION_GOVERNANCE_REVIEWED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    governanceOnly: true,
    timestamp,
    recommendationApprovalReview,
    riskImpactReview,
    correlationImpactReview,
    factorExposureImpactReview,
    capitalAllocationImpactReview,
    aiDecisionReview,
    operatorActionClassification,
    governanceStatus,
    summary: `Portfolio optimization governance ${governanceStatus}: ${operatorActionClassification.classification}.`,
    sourceEvents: {
      portfolioOptimization: portfolioOptimization.eventType ?? null,
      portfolioRisk: portfolioRisk.eventType ?? null,
      portfolioCorrelation: portfolioCorrelation.eventType ?? null,
      portfolioFactorExposure: portfolioFactorExposure.eventType ?? null,
      capitalAllocation: capitalAllocation.eventType ?? null,
      aiDecision: aiDecision.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_OPTIMIZATION_GOVERNANCE_REVIEWED_EVENT, result)
  }

  return result
}

export function createPortfolioOptimizationGovernanceEngine(options = {}) {
  return {
    review(input, reviewOptions = {}) {
      return reviewPortfolioOptimizationGovernance(input, { ...options, ...reviewOptions })
    },
  }
}
