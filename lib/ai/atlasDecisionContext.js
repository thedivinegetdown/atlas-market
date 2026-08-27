export const ATLAS_DECISION_CONTEXT_VERSION = 'atlas-decision-context-v1'

const text = (value, fallback = null) => { const result = String(value ?? '').trim(); return result || fallback }
const planProjection = (plan = {}) => ({ planId: text(plan.planId), symbol: text(plan.symbol)?.toUpperCase() ?? null, side: text(plan.side), strategyId: text(plan.strategyId), decisionStatus: text(plan.decision?.status, 'INSUFFICIENT_DATA'), tradeQuality: { score: plan.quality?.score ?? null, band: text(plan.quality?.band, 'UNKNOWN') }, regime: plan.regime?.trendRegime ?? 'UNKNOWN', structure: { entry: plan.structure?.entry ?? null, stop: plan.structure?.stop ?? null, target: plan.structure?.target ?? null, maximumPlannedLoss: plan.risk?.maximumPlannedLoss ?? null }, reasons: [...(plan.decision?.supportingReasons ?? [])].slice(0, 4), cautionReasons: [...(plan.decision?.cautionReasons ?? [])].slice(0, 4), evidenceFingerprint: plan.integrity?.evidenceFingerprint ?? null })

export function buildAtlasDecisionContext({ plans = [], ranking = {}, portfolioAdmissions = [], strategyRegistry = {}, decisionQuality = null, marketContext = null, selectedPlanId = null, generatedAt = new Date().toISOString() } = {}) {
  const safePlans = Array.isArray(plans) ? plans : []
  const selected = safePlans.find((plan) => plan.planId === selectedPlanId) ?? safePlans.find((plan) => plan.decision?.status === 'QUALIFIED') ?? safePlans[0] ?? null
  const selectedProjection = selected ? planProjection(selected) : null
  const admission = (Array.isArray(portfolioAdmissions) ? portfolioAdmissions : []).find((entry) => entry.planId === selectedProjection?.planId) ?? null
  return Object.freeze({
    version: ATLAS_DECISION_CONTEXT_VERSION,
    market: marketContext ? { regime: marketContext.marketRegime?.classification?.trendRegime ?? selectedProjection?.regime ?? 'UNAVAILABLE', participation: { status: marketContext.participation?.status ?? 'UNAVAILABLE', label: marketContext.participation?.labels?.display ?? 'SECTOR ETF PARTICIPATION PROXY' }, leaders: (marketContext.sectorLeadership?.leaders ?? []).slice(0, 3).map((entry) => ({ symbol: entry.symbol, status: entry.leadershipStatus, relativeToSpy20: entry.relativeToSpy20 })), laggards: (marketContext.sectorLeadership?.laggards ?? []).slice(0, 3).map((entry) => ({ symbol: entry.symbol, status: entry.leadershipStatus, relativeToSpy20: entry.relativeToSpy20 })), trueExchangeBreadthAvailable: false } : (selectedProjection ? { regime: selectedProjection.regime } : { regime: 'UNAVAILABLE' }),
    topQualifiedPlans: safePlans.filter((plan) => plan.decision?.status === 'QUALIFIED').slice(0, 5).map(planProjection),
    watchPlans: safePlans.filter((plan) => plan.decision?.status === 'WATCH').slice(0, 5).map(planProjection),
    selectedPlan: selectedProjection,
    ranking: { version: ranking.version ?? null, qualified: (ranking.qualified ?? []).slice(0, 5).map((entry) => ({ planId: entry.planReference?.planId, rank: entry.rank, score: entry.rankingScore, reasons: [...(entry.rankingReasons ?? [])].slice(0, 3) })), watchCount: (ranking.watch ?? []).length },
    portfolioAdmission: admission ? { planId: admission.planId, admissionStatus: admission.admissionStatus, duplicateSymbolStatus: admission.duplicateSymbolStatus, existingSymbolExposure: admission.existingSymbolExposure, concentrationStatus: admission.concentrationStatus, strategyOverlapStatus: admission.strategyOverlapStatus, correlationStatus: admission.correlationStatus, reasons: [...(admission.reasons ?? [])].slice(0, 4), cautionReasons: [...(admission.cautionReasons ?? [])].slice(0, 4) } : { status: 'UNAVAILABLE' },
    strategyRegistry: { version: strategyRegistry.version ?? null, strategies: (strategyRegistry.strategies ?? []).slice(0, 8).map((entry) => ({ strategyId: entry.strategyId, familyId: entry.familyId, implementationStatus: entry.implementationStatus, paperEligibility: entry.paperEligibility })) },
    decisionQuality: decisionQuality ? { status: decisionQuality.status, completedOutcomes: decisionQuality.overall?.completedOutcomes, expectancy: decisionQuality.overall?.expectancy, profitFactor: decisionQuality.overall?.profitFactor, averageR: decisionQuality.rNormalized?.metrics?.averageR ?? 'UNAVAILABLE', recentTrend: decisionQuality.recentTrend, tqCalibration: decisionQuality.tqCalibration?.status ?? 'UNAVAILABLE', descriptiveOnly: true } : { status: 'UNAVAILABLE' },
    evidenceAvailability: { portfolioAdmission: admission ? 'AVAILABLE' : 'UNAVAILABLE', decisionQuality: decisionQuality ? 'AVAILABLE' : 'UNAVAILABLE', empiricalConfidence: 'UNAVAILABLE' },
    provenance: { planVersion: selected?.version ?? null, rankingVersion: ranking.version ?? null, generatedFrom: 'deterministic_atlas_read_models' },
    generatedAt,
    boundaries: { readOnly: true, deterministicStatusAuthoritative: true, empiricalConfidence: 'UNAVAILABLE', executionActionsExposed: false, liveTradingActionsExposed: false },
  })
}

export function applyDeterministicDecisionAuthority(explanation = {}, context = {}) {
  return Object.freeze({ ...explanation, deterministicDecisionStatus: context.selectedPlan?.decisionStatus ?? 'UNAVAILABLE', deterministicStatusAuthoritative: true, empiricalConfidence: 'UNAVAILABLE', executionActionsExposed: false, liveTradingActionsExposed: false })
}