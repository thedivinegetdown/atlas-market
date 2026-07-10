import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ADMINISTRATIVE_GOVERNANCE_COMMAND_CENTER_EVALUATED_EVENT = 'system.administrativeGovernanceCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(summary) {
  if (summary.criticalUnresolvedResidualRisk > 0 || summary.ineffectiveRemediationPlans > 0) return 'blocked'
  if (summary.evidenceRequiringReview > 0 || summary.retentionReviewsDue > 0 || summary.overdueFollowUpReviews > 0 || summary.inconclusiveRemediationPlans > 0) return 'caution'
  return 'healthy'
}

export function evaluateAdministrativeGovernanceCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const evidenceGovernance = input.evidenceGovernance ?? {}
  const remediationEffectiveness = input.remediationEffectiveness ?? {}
  const governanceEvaluations = evidenceGovernance.evidenceGovernanceEvaluations ?? []
  const effectivenessEvaluations = remediationEffectiveness.remediationEffectivenessEvaluations ?? []
  const now = options.timestamp ?? getNowIso()
  const summary = {
    evidenceGovernanceHealth: evidenceGovernance.governanceStatus ?? 'healthy',
    evidenceRequiringReview: evidenceGovernance.governanceSummary?.reviewRequired ?? governanceEvaluations.filter((item) => item.governanceStatus === 'review_required').length,
    unverifiedOrDisputedEvidence: evidenceGovernance.governanceSummary?.unverifiedOrDisputed ?? governanceEvaluations.filter((item) => ['unverified', 'disputed'].includes(item.integrityStatus)).length,
    retentionReviewsDue: evidenceGovernance.governanceSummary?.retentionDue ?? governanceEvaluations.filter((item) => item.governanceStatus === 'retention_due').length,
    orphanedEvidence: evidenceGovernance.governanceSummary?.orphanedEvidence ?? governanceEvaluations.filter((item) => item.governanceFindings?.some((finding) => finding.code === 'orphaned-evidence')).length,
    remediationEffectivenessDistribution: {
      effective: remediationEffectiveness.effectivenessSummary?.effective ?? 0,
      partiallyEffective: remediationEffectiveness.effectivenessSummary?.partiallyEffective ?? 0,
      ineffective: remediationEffectiveness.effectivenessSummary?.ineffective ?? 0,
      inconclusive: remediationEffectiveness.effectivenessSummary?.inconclusive ?? 0,
      pendingEvaluation: remediationEffectiveness.effectivenessSummary?.pendingEvaluation ?? 0,
    },
    ineffectiveRemediationPlans: remediationEffectiveness.effectivenessSummary?.ineffective ?? effectivenessEvaluations.filter((item) => item.effectivenessRating === 'ineffective').length,
    inconclusiveRemediationPlans: remediationEffectiveness.effectivenessSummary?.inconclusive ?? effectivenessEvaluations.filter((item) => item.effectivenessRating === 'inconclusive').length,
    overdueFollowUpReviews: effectivenessEvaluations.filter((item) => item.followUpDueDate && new Date(item.followUpDueDate).getTime() <= new Date(now).getTime() && item.followUpRequired).length,
    repeatedFindingsAfterRemediation: remediationEffectiveness.effectivenessSummary?.repeatedFindings ?? effectivenessEvaluations.reduce((sum, item) => sum + Number(item.repeatedFindingCount ?? 0), 0),
    reopenedAdministrativeCases: effectivenessEvaluations.filter((item) => item.findings?.includes('case-reopened-after-remediation')).length,
    criticalUnresolvedResidualRisk: remediationEffectiveness.effectivenessSummary?.criticalResidualRisk ?? effectivenessEvaluations.filter((item) => item.currentResidualRisk === 'critical').length,
    tenantAdministrationHealth: input.tenantAdministrationOperations?.operationalStatus ?? 'healthy',
    operatorIntelligenceHealth: input.operatorIntelligenceCommandCenter?.commandCenterStatus ?? input.operatorAttention?.status ?? 'healthy',
    investigationRemediationHealth: input.investigationRemediationCommandCenter?.commandCenterStatus ?? 'healthy',
  }
  const commandCenterStatus = statusFrom(summary)
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_GOVERNANCE_COMMAND_CENTER_EVALUATED_EVENT,
    timestamp: now,
    ...summary,
    commandCenterStatus,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    humanReviewOnly: true,
    destructiveActionsEnabled: false,
    automaticEvidenceDeletion: false,
    automaticRemediationEnforcement: false,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Administrative governance ${commandCenterStatus}: ${summary.evidenceRequiringReview} evidence items need review, ${summary.ineffectiveRemediationPlans} plans are ineffective, and ${summary.criticalUnresolvedResidualRisk} residual risks remain critical.`,
    sourceEvents: {
      evidenceGovernance: evidenceGovernance.eventType ?? null,
      remediationEffectiveness: remediationEffectiveness.eventType ?? null,
      tenantAdministrationOperations: input.tenantAdministrationOperations?.eventType ?? null,
      operatorIntelligenceCommandCenter: input.operatorIntelligenceCommandCenter?.eventType ?? null,
      investigationRemediationCommandCenter: input.investigationRemediationCommandCenter?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ADMINISTRATIVE_GOVERNANCE_COMMAND_CENTER_EVALUATED_EVENT, result)
  return result
}
