import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_OPERATIONS_COMMAND_CENTER_EVALUATED_EVENT = 'system.complianceOperationsCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(summary) {
  if (summary.packagesNeedingUpdates > 0 || summary.reviewChangesRequested > 0 || summary.complianceReadinessHealth === 'blocked') return 'blocked'
  if (summary.packagesReadyForReview > 0 || summary.reviewsQueued > 0 || summary.complianceReadinessHealth === 'caution') return 'caution'
  return 'healthy'
}

export function evaluateComplianceOperationsCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const evidencePackage = input.complianceEvidencePackage ?? {}
  const reviewWorkflow = input.complianceReviewWorkflow ?? {}
  const readiness = input.complianceReadinessCommandCenter ?? {}
  const summary = {
    evidencePackageHealth: evidencePackage.packageStatus ?? 'healthy',
    packagesReadyForReview: evidencePackage.packageSummary?.readyForReview ?? 0,
    packagesNeedingUpdates: evidencePackage.packageSummary?.needsUpdates ?? 0,
    reviewedPackages: evidencePackage.packageSummary?.reviewed ?? 0,
    averagePackageCompleteness: evidencePackage.packageSummary?.averageCompleteness ?? 0,
    reviewWorkflowHealth: reviewWorkflow.workflowStatus ?? 'healthy',
    reviewsQueued: reviewWorkflow.reviewSummary?.queued ?? 0,
    reviewsInProgress: reviewWorkflow.reviewSummary?.inReview ?? 0,
    reviewChangesRequested: reviewWorkflow.reviewSummary?.changesRequested ?? 0,
    reviewsApprovedForReadiness: reviewWorkflow.reviewSummary?.approvedForReadiness ?? 0,
    complianceReadinessHealth: readiness.commandCenterStatus ?? 'healthy',
    policyAssuranceHealth: input.policyControlAssuranceCommandCenter?.commandCenterStatus ?? 'healthy',
    administrativeGovernanceHealth: input.administrativeGovernanceCommandCenter?.commandCenterStatus ?? 'healthy',
  }
  const commandCenterStatus = statusFrom(summary)
  const result = {
    eventType: SYSTEM_COMPLIANCE_OPERATIONS_COMMAND_CENTER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    ...summary,
    commandCenterStatus,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticEvidenceExport: false,
    automaticApproval: false,
    automaticEnforcementActions: false,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance operations ${commandCenterStatus}: ${summary.packagesReadyForReview} evidence packages ready and ${summary.reviewsQueued} reviews queued.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_OPERATIONS_COMMAND_CENTER_EVALUATED_EVENT, result)
  return result
}
