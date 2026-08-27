import { composeQualifiedTradePlan, rankQualifiedTradePlans, buildPortfolioAdmission } from '../opportunities/qualifiedTradePlan/index.js'
import { buildStrategyFamilyRegistry } from '../strategies/registry/index.js'
import { buildDecisionQualityMonitor } from '../analytics/decisionQualityMonitor.js'
import { buildAtlasDecisionContext } from '../ai/atlasDecisionContext.js'
import { resolvePersistedForwardObservationStatuses } from '../opportunities/forwardTest/persistedObservationStatus.js'

export const ATLAS_DECISION_INTELLIGENCE_VERSION = 'atlas-decision-intelligence-v1'

const executionOutcome = (execution = {}) => ({ id: execution.executionId ?? execution.fingerprint, status: 'SIMULATED_FILLED', symbol: execution.symbol, strategyId: execution.strategyId, experimentId: execution.experimentId ?? execution.forwardObservation?.experimentId ?? execution.payload?.experimentId ?? execution.payload?.forwardObservation?.experimentId ?? execution.payload?.qualifiedTradePlan?.integrity?.experimentId ?? null, simulatedAt: execution.evidenceTimestamp ?? execution.createdAt, accountingStatus: execution.executionType === 'close' ? 'position_closed' : 'position_reduced', realizedPnl: execution.realizedPnlDelta, tradeQuality: execution.payload?.tradeQuality, regime: execution.payload?.regime, evaluationStatus: execution.payload?.evaluationStatus, exitPolicy: execution.payload?.exitPolicy, paperTradingOnly: true })
const bounded = (values, limit = 5) => (Array.isArray(values) ? values : []).slice(0, limit)
const status = (plans) => plans.some((plan) => plan.market?.freshness === 'STALE') ? 'STALE' : plans.length ? 'AVAILABLE' : 'INSUFFICIENT_DATA'

export async function buildDecisionIntelligence({ tenantContext = {}, accountId, selectedPlanId = null, evidenceRepository, ledgerRepository, evaluations, positions, account, executions, correlationEvidence = null, marketContext = null, observationStatuses, observationStatusResolver = resolvePersistedForwardObservationStatuses, generatedAt = new Date().toISOString() } = {}) {
  if (!tenantContext.organizationId || !tenantContext.userId || !accountId) throw new Error('tenant and account scope are required for decision intelligence')
  const scope = { tenantContext, accountId, userId: tenantContext.userId }
  const loadedEvaluations = evaluations ?? await evidenceRepository?.listPaperEvaluations?.(scope) ?? []
  const ledgerAccount = account ? { account, positions: positions ?? [] } : await ledgerRepository?.getOrCreateAccount?.(scope) ?? { account: null, positions: positions ?? null }
  const loadedExecutions = executions ?? await ledgerRepository?.listExecutions?.(scope) ?? []
  const resolvedObservationStatuses = observationStatuses ?? await observationStatusResolver({ evidenceRepository, ledgerRepository, executions: loadedExecutions, ...scope })
  const plans = bounded(loadedEvaluations, 20).map((evaluation) => composeQualifiedTradePlan({ evaluation }, { generatedAt: evaluation.evaluatedAt ?? generatedAt }))
  const registry = buildStrategyFamilyRegistry()
  const admissions = plans.map((plan) => buildPortfolioAdmission({ plan, positions: positions ?? ledgerAccount.positions, account: ledgerAccount.account ?? {}, registry, correlationEvidence, generatedAt }))
  const ranking = rankQualifiedTradePlans({ plans, portfolioAdmissions: admissions })
  const decisionQuality = buildDecisionQualityMonitor({ outcomes: loadedExecutions.filter((execution) => ['reduction', 'close'].includes(execution.executionType)).map(executionOutcome), registry, generatedAt })
  const selectedPlan = plans.find((plan) => plan.planId === selectedPlanId) ?? null
  const copilotContext = buildAtlasDecisionContext({ plans, ranking, portfolioAdmissions: admissions, strategyRegistry: registry, decisionQuality, marketContext, observationStatuses: resolvedObservationStatuses, selectedPlanId, generatedAt })
  const topQualifiedPlans = bounded(ranking.qualified, 5)
  const watchPlans = bounded(ranking.watch, 5)
  return Object.freeze({
    version: ATLAS_DECISION_INTELLIGENCE_VERSION,
    identity: { organizationId: tenantContext.organizationId, teamWorkspaceId: tenantContext.teamWorkspaceId ?? null, userId: tenantContext.userId, accountId, generatedAt },
    market: { status: marketContext?.evidenceAvailability?.sectorLeadership === 'UNAVAILABLE' ? 'DEGRADED' : status(plans), freshness: plans.some((plan) => plan.market?.freshness === 'STALE') ? 'STALE' : marketContext?.benchmarks?.[0]?.freshness ?? plans[0]?.market?.freshness ?? 'UNAVAILABLE', provenance: marketContext?.provenance ?? plans[0]?.market?.provenance ?? null, context: marketContext },
    opportunities: { topQualifiedPlans, watchPlans, qualifiedCount: ranking.qualified.length, watchCount: ranking.watch.length, blockedCount: admissions.filter((admission) => admission.admissionStatus === 'BLOCKED').length, emptyQualifiedState: topQualifiedPlans.length === 0 ? 'NO_QUALIFIED_OPPORTUNITIES' : null },
    ranking,
    portfolio: { admissions: bounded(admissions, 10), exposure: { accountEquity: ledgerAccount.account?.equity ?? null, openPositionCount: Array.isArray(ledgerAccount.positions) ? ledgerAccount.positions.length : null, status: Array.isArray(ledgerAccount.positions) ? 'AVAILABLE' : 'UNAVAILABLE' } },
    strategy: { registry, selectableStrategyIds: registry.selectableStrategyIds },
    observations: bounded(resolvedObservationStatuses, 8),
    decisionQuality: { status: decisionQuality.status, overall: decisionQuality.overall, rNormalized: decisionQuality.rNormalized, recentTrend: decisionQuality.recentTrend, tqCalibration: decisionQuality.tqCalibration, groupings: { byStrategyId: bounded(decisionQuality.groupings.byStrategyId, 5), byExperimentId: bounded(decisionQuality.groupings.byExperimentId, 5), byRegime: { trend: bounded(decisionQuality.groupings.byRegime.trend, 5) }, byTqBand: bounded(decisionQuality.groupings.byTqBand, 5) } },
    selectedDecision: selectedPlan ? { plan: selectedPlan, admission: admissions.find((admission) => admission.planId === selectedPlan.planId) ?? null } : null,
    copilotContext,
    evidence: { availability: { evaluations: loadedEvaluations.length ? 'AVAILABLE' : 'UNAVAILABLE', portfolio: Array.isArray(ledgerAccount.positions) ? 'AVAILABLE' : 'UNAVAILABLE', decisionQuality: loadedExecutions.length ? 'AVAILABLE' : 'UNAVAILABLE', correlation: correlationEvidence?.status ? 'AVAILABLE' : 'UNAVAILABLE' }, empiricalConfidence: 'UNAVAILABLE', fingerprints: plans.map((plan) => ({ planId: plan.planId, evidenceFingerprint: plan.integrity?.evidenceFingerprint ?? null, strategyFingerprint: plan.integrity?.strategyFingerprint ?? null, policyFingerprint: plan.integrity?.policyFingerprint ?? null })) },
    boundaries: { paperOnly: true, humanReviewRequired: true, liveExecutionDisabled: true, deterministicAuthority: true, empiricalConfidence: 'UNAVAILABLE', executableActionsExposed: false },
  })
}