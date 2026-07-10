import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_RISK_COMMAND_CENTER_EVALUATED_EVENT = 'system.complianceRiskCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(summary) {
  if (summary.slaBreaches > 0 || summary.criticalFindings > 0 || summary.criticalEscalations > 0) return 'blocked'
  if (summary.obligationsNeedingEvidence > 0 || summary.openEvidenceRequests > 0 || summary.openFindings > 0 || summary.plannedEscalations > 0) return 'caution'
  return 'healthy'
}

export function evaluateComplianceRiskCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const obligations = input.complianceObligationMapping?.obligationSummary ?? {}
  const requests = input.complianceEvidenceRequestQueue?.requestSummary ?? {}
  const findings = input.complianceReviewFindingTracker?.findingSummary ?? {}
  const slas = input.complianceReviewSla?.slaSummary ?? {}
  const escalations = input.complianceEscalationPlanning?.escalationSummary ?? {}
  const operations = input.complianceOperationsCommandCenter ?? {}
  const summary = {
    complianceOperationsHealth: operations.commandCenterStatus ?? 'healthy',
    totalObligations: obligations.total ?? 0,
    obligationsNeedingEvidence: obligations.needsEvidence ?? 0,
    evidenceCoverageAverage: obligations.averageCoverage ?? 0,
    openEvidenceRequests: requests.open ?? 0,
    highPriorityEvidenceRequests: requests.highPriority ?? 0,
    openFindings: findings.open ?? 0,
    criticalFindings: findings.critical ?? 0,
    slaAtRisk: slas.atRisk ?? 0,
    slaBreaches: slas.breached ?? 0,
    plannedEscalations: escalations.planned ?? 0,
    criticalEscalations: escalations.critical ?? 0,
  }
  const commandCenterStatus = statusFrom(summary)
  const result = {
    eventType: SYSTEM_COMPLIANCE_RISK_COMMAND_CENTER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    ...summary,
    commandCenterStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    automaticEscalationExecution: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance risk command center ${commandCenterStatus}: ${summary.openFindings} open findings, ${summary.slaBreaches} SLA breaches, and ${summary.plannedEscalations} planned escalations.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_RISK_COMMAND_CENTER_EVALUATED_EVENT, result)
  return result
}
