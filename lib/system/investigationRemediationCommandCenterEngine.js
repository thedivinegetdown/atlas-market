import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INVESTIGATION_REMEDIATION_COMMAND_CENTER_EVALUATED_EVENT = 'system.investigationRemediationCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(summary) {
  if (summary.overdueRemediationPlans > 0 || summary.blockedPlans > 0 || summary.casesWithoutEvidence > 0) return 'blocked'
  if (summary.evidenceAwaitingReview > 0 || summary.plansAwaitingApproval > 0 || summary.highConfidenceEvidenceFindings > 0) return 'caution'
  return 'healthy'
}

export function evaluateInvestigationRemediationCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const cases = input.administrativeCases?.administrativeCases ?? []
  const evidence = input.administrativeEvidence?.administrativeEvidence ?? []
  const plans = input.remediationPlanning?.remediationPlans ?? []
  const summary = {
    openInvestigations: cases.filter((item) => ['open', 'investigating', 'monitoring'].includes(item.status)).length,
    casesWithoutEvidence: cases.filter((item) => !evidence.some((evidenceItem) => evidenceItem.relatedCaseId === item.id)).length,
    evidenceAwaitingReview: evidence.filter((item) => item.humanReviewStatus === 'awaiting_review').length,
    highConfidenceEvidenceFindings: evidence.filter((item) => item.confidence >= 0.8).length,
    draftRemediationPlans: plans.filter((item) => item.approvalStatus === 'draft').length,
    plansAwaitingApproval: plans.filter((item) => item.approvalStatus === 'pending_approval').length,
    approvedPlansAwaitingHumanExecution: plans.filter((item) => item.approvalStatus === 'approved' && item.executionStatus === 'not_started').length,
    overdueRemediationPlans: plans.filter((item) => item.dueDate && !['completed', 'cancelled'].includes(item.executionStatus)).length,
    blockedPlans: plans.filter((item) => item.executionStatus === 'blocked').length,
    recentlyCompletedPlans: plans.filter((item) => item.executionStatus === 'completed').length,
    tenantAdministrationHealth: input.tenantAdministrationOperations?.operationalStatus ?? 'healthy',
    operatorAttentionHealth: input.operatorAttention?.status ?? 'healthy',
  }
  const commandCenterStatus = statusFrom(summary)
  const result = {
    eventType: SYSTEM_INVESTIGATION_REMEDIATION_COMMAND_CENTER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    ...summary,
    commandCenterStatus,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    humanReviewOnly: true,
    destructiveActionsEnabled: false,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Investigation and remediation command center ${commandCenterStatus}: ${summary.openInvestigations} open investigations, ${summary.evidenceAwaitingReview} evidence items awaiting review, and ${summary.plansAwaitingApproval} plans awaiting approval.`,
    sourceEvents: {
      administrativeCases: input.administrativeCases?.eventType ?? null,
      administrativeEvidence: input.administrativeEvidence?.eventType ?? null,
      remediationPlanning: input.remediationPlanning?.eventType ?? null,
      tenantAdministrationOperations: input.tenantAdministrationOperations?.eventType ?? null,
      operatorAttention: input.operatorAttention?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_INVESTIGATION_REMEDIATION_COMMAND_CENTER_EVALUATED_EVENT, result)
  return result
}
