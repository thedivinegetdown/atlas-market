import { rankOpportunityCandidates } from '../../ai/opportunityAnalysisEngine.js'

export const QUALIFIED_OPPORTUNITY_RANKING_VERSION = 'qualified-opportunity-ranking-v1'

const RANKED_STATUS = 'QUALIFIED'
const WATCH_STATUS = 'WATCH'

function portfolioAvailability(portfolioEvidence) {
  if (!portfolioEvidence || typeof portfolioEvidence !== 'object') return { status: 'UNAVAILABLE', reasons: ['No authoritative portfolio exposure evidence was supplied.'] }
  return { status: String(portfolioEvidence.status ?? 'AVAILABLE').toUpperCase(), reasons: Array.isArray(portfolioEvidence.reasons) ? [...portfolioEvidence.reasons] : [] }
}

function candidateFromPlan(plan, portfolio) {
  const coverage = Number(plan.quality?.coverage)
  const gateBlocked = plan.risk?.gateStatus === 'BLOCKED'
  return {
    opportunityId: plan.planId,
    symbol: plan.symbol,
    asOf: plan.generatedAt,
    category: 'qualified_trade_plan',
    direction: plan.side,
    timeframe: plan.timeframe ?? 'session',
    scannerSource: 'qualified-trade-plan',
    scannerScore: Number(plan.quality?.score ?? 0),
    strategyId: plan.strategyId,
    strategyQualification: plan.strategy?.suitability === 'ENABLED' ? 'qualified' : plan.strategy?.suitability === 'CONDITIONAL' ? 'compatible' : 'disqualified',
    marketRegime: { regime: plan.regime?.trendRegime ?? 'UNKNOWN' },
    liquiditySummary: { status: 'unknown' },
    riskSummary: { riskLevel: gateBlocked ? 'critical' : 'low', score: gateBlocked ? 100 : 0 },
    dataQuality: { status: coverage >= 90 ? 'healthy' : coverage > 0 ? 'partial' : 'unknown' },
    missingData: [],
    stale: plan.market?.freshness === 'STALE',
    invalidationConditions: plan.structure?.invalidation ? [plan.structure.invalidation] : [],
    signalSummary: (plan.decision?.supportingReasons ?? []).join(' '),
    hardRejectionReasons: gateBlocked ? (plan.risk?.rejectionReasons ?? ['Existing risk gate is blocked']) : [],
    portfolioConflictSummary: portfolio.status === 'CONFLICT' ? { status: 'conflict', conflicts: true } : {},
  }
}

function resultFromRanking(plan, ranking, rank, population, portfolio) {
  return Object.freeze({
    version: QUALIFIED_OPPORTUNITY_RANKING_VERSION,
    rank,
    symbol: plan.symbol,
    side: plan.side,
    strategyId: plan.strategyId,
    decisionStatus: plan.decision.status,
    rankingScore: ranking.rankingScore,
    rankingBand: ranking.rankingTier,
    rankingReasons: ranking.explainability.positiveContributors,
    cautionReasons: [...ranking.explainability.negativeContributors, ...plan.decision.cautionReasons],
    tradeQuality: { score: plan.quality.score, band: plan.quality.band, confidence: plan.quality.confidence, coverage: plan.quality.coverage },
    regime: plan.regime,
    riskReward: plan.structure.rMultiple,
    freshness: plan.market.freshness,
    portfolioEvidence: portfolio,
    planReference: { planId: plan.planId, evidenceFingerprint: plan.integrity?.evidenceFingerprint ?? null },
    population,
    advisoryOnly: true,
    paperTradingOnly: true,
    executable: false,
  })
}

function rankPopulation(plans, population, portfolio, admissions = {}) {
  const rankings = rankOpportunityCandidates(plans.map((plan) => candidateFromPlan(plan, portfolio)))
  const rankingByPlanId = new Map(rankings.map((ranking) => [ranking.opportunityId, ranking]))
  return plans
    .map((plan) => ({ plan, ranking: rankingByPlanId.get(plan.planId) }))
    .filter((entry) => entry.ranking?.rankingStatus === 'ranked' && admissions[entry.plan.planId]?.admissionStatus !== 'BLOCKED')
    .sort((left, right) => left.ranking.deterministicRank - right.ranking.deterministicRank)
    .map((entry, index) => resultFromRanking(entry.plan, entry.ranking, index + 1, population, portfolio))
}

export function rankQualifiedTradePlans({ plans = [], portfolioEvidence, portfolioAdmissions = [] } = {}) {
  if (!Array.isArray(plans)) throw new Error('qualified trade plans input is invalid')
  const portfolio = portfolioAvailability(portfolioEvidence)
  const admissions = Object.fromEntries((Array.isArray(portfolioAdmissions) ? portfolioAdmissions : []).filter((admission) => admission?.planId).map((admission) => [admission.planId, admission]))
  const qualifiedPlans = plans.filter((plan) => plan?.decision?.status === RANKED_STATUS)
  const watchPlans = plans.filter((plan) => plan?.decision?.status === WATCH_STATUS)
  return Object.freeze({
    version: QUALIFIED_OPPORTUNITY_RANKING_VERSION,
    qualified: rankPopulation(qualifiedPlans, 'QUALIFIED', portfolio, admissions),
    watch: rankPopulation(watchPlans, 'WATCH', portfolio, admissions),
    excludedPlanIds: plans.filter((plan) => ![RANKED_STATUS, WATCH_STATUS].includes(plan?.decision?.status)).map((plan) => plan?.planId ?? null).filter(Boolean),
    portfolioEvidence: portfolio,
    portfolioAdmissions: Object.freeze({ ...admissions }),
    advisoryOnly: true,
    paperTradingOnly: true,
    executable: false,
  })
}