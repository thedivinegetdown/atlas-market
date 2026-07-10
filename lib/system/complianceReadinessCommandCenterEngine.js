import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_READINESS_COMMAND_CENTER_EVALUATED_EVENT = 'system.complianceReadinessCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(summary) {
  if (summary.failedControlTests > 0 || summary.expiredAttestations > 0 || summary.criticalPolicyExceptions > 0) return 'blocked'
  if (summary.pendingAttestations > 0 || summary.controlsInTesting > 0 || summary.policyAssuranceHealth !== 'healthy') return 'caution'
  return 'healthy'
}

export function evaluateComplianceReadinessCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const attestation = input.policyAttestation ?? {}
  const testing = input.controlTesting ?? {}
  const policyControl = input.policyControlAssuranceCommandCenter ?? {}
  const summary = {
    policyAssuranceHealth: policyControl.commandCenterStatus ?? 'healthy',
    pendingAttestations: attestation.attestationSummary?.pending ?? 0,
    attestedPolicies: attestation.attestationSummary?.attested ?? 0,
    attestationsWithExceptions: attestation.attestationSummary?.exceptionsNoted ?? 0,
    expiredAttestations: attestation.attestationSummary?.expired ?? 0,
    passedControlTests: testing.testingSummary?.passed ?? 0,
    failedControlTests: testing.testingSummary?.failed ?? 0,
    blockedControlTests: testing.testingSummary?.blocked ?? 0,
    controlsInTesting: testing.testingSummary?.inProgress ?? 0,
    criticalPolicyExceptions: policyControl.criticalExceptionSeverity ?? 0,
    openPolicyExceptions: policyControl.openPolicyExceptions ?? 0,
    administrativeGovernanceHealth: input.administrativeGovernanceCommandCenter?.commandCenterStatus ?? 'healthy',
    releaseControlHealth: input.enterpriseReleaseControl?.finalReleaseStatus ?? input.releaseControl?.finalReleaseStatus ?? 'caution',
  }
  const commandCenterStatus = statusFrom(summary)
  const result = {
    eventType: SYSTEM_COMPLIANCE_READINESS_COMMAND_CENTER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    ...summary,
    commandCenterStatus,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticEnforcementActions: false,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance readiness ${commandCenterStatus}: ${summary.pendingAttestations} pending attestations and ${summary.failedControlTests} failed control tests.`,
    sourceEvents: {
      policyAttestation: attestation.eventType ?? null,
      controlTesting: testing.eventType ?? null,
      policyControlAssuranceCommandCenter: policyControl.eventType ?? null,
      administrativeGovernanceCommandCenter: input.administrativeGovernanceCommandCenter?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_READINESS_COMMAND_CENTER_EVALUATED_EVENT, result)
  return result
}
