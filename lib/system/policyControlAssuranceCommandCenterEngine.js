import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_POLICY_CONTROL_ASSURANCE_COMMAND_CENTER_EVALUATED_EVENT = 'system.policyControlAssuranceCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(summary) {
  if (summary.criticalExceptionSeverity > 0 || summary.controlsLinkedToCriticalResidualRisk > 0 || summary.controlsLinkedToIneffectiveRemediation > 0) return 'blocked'
  if (summary.policiesPastReviewDate > 0 || summary.controlsWithoutEvidence > 0 || summary.openPolicyExceptions > 0 || summary.weakOrUnknownAssuranceControls > 0) return 'caution'
  return 'healthy'
}

export function evaluatePolicyControlAssuranceCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const policyGovernance = input.policyGovernance ?? {}
  const controlAssurance = input.controlAssurance ?? {}
  const policySummary = policyGovernance.policySummary ?? {}
  const assuranceSummary = controlAssurance.assuranceSummary ?? {}
  const summary = {
    activePolicies: policySummary.active ?? 0,
    policiesUnderReview: policySummary.underReview ?? 0,
    policiesPastReviewDate: policySummary.pastReviewDate ?? 0,
    controlsByEffectiveness: {
      effective: assuranceSummary.effective ?? 0,
      partiallyEffective: assuranceSummary.partiallyEffective ?? 0,
      ineffective: assuranceSummary.ineffective ?? 0,
      notEvaluated: assuranceSummary.notEvaluated ?? 0,
    },
    controlsWithoutEvidence: assuranceSummary.controlsWithoutEvidence ?? 0,
    weakOrUnknownAssuranceControls: assuranceSummary.weakOrUnknownAssurance ?? 0,
    openPolicyExceptions: assuranceSummary.openPolicyExceptions ?? 0,
    expiredTemporaryExceptions: assuranceSummary.expiredTemporaryExceptions ?? 0,
    criticalExceptionSeverity: assuranceSummary.criticalExceptionSeverity ?? 0,
    repeatedControlFailures: assuranceSummary.repeatedControlFailures ?? 0,
    controlsLinkedToIneffectiveRemediation: assuranceSummary.linkedIneffectiveRemediation ?? 0,
    controlsLinkedToCriticalResidualRisk: assuranceSummary.linkedCriticalResidualRisk ?? 0,
    administrativeGovernanceHealth: input.administrativeGovernanceCommandCenter?.commandCenterStatus ?? 'healthy',
    tenantAdministrationHealth: input.tenantAdministrationOperations?.operationalStatus ?? 'healthy',
    operatorIntelligenceHealth: input.operatorIntelligenceCommandCenter?.commandCenterStatus ?? 'healthy',
  }
  const commandCenterStatus = statusFrom(summary)
  const result = {
    eventType: SYSTEM_POLICY_CONTROL_ASSURANCE_COMMAND_CENTER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    ...summary,
    commandCenterStatus,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    humanReviewOnly: true,
    automaticPolicyEnforcement: false,
    automaticExceptionApproval: false,
    destructiveActionsEnabled: false,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Policy and control assurance ${commandCenterStatus}: ${summary.activePolicies} active policies, ${summary.openPolicyExceptions} open exceptions, and ${summary.controlsWithoutEvidence} controls without evidence.`,
    sourceEvents: {
      policyGovernance: policyGovernance.eventType ?? null,
      controlAssurance: controlAssurance.eventType ?? null,
      administrativeGovernanceCommandCenter: input.administrativeGovernanceCommandCenter?.eventType ?? null,
      tenantAdministrationOperations: input.tenantAdministrationOperations?.eventType ?? null,
      operatorIntelligenceCommandCenter: input.operatorIntelligenceCommandCenter?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_POLICY_CONTROL_ASSURANCE_COMMAND_CENTER_EVALUATED_EVENT, result)
  return result
}
