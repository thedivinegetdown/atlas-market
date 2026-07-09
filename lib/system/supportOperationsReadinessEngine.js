import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_SUPPORT_OPERATIONS_EVALUATED_EVENT = 'system.supportOperations.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed', 'approved', 'executed'].includes(status)) return 'ready'
  return 'caution'
}

function supportSummary(id, label, sourceStatus, sourceEvent, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    ...details,
  }
}

function resolveSupportReadinessStatus(summaries) {
  if (summaries.some((summary) => summary.status === 'blocked')) return 'blocked'
  if (summaries.some((summary) => summary.status === 'caution')) return 'caution'
  return 'ready'
}

export function evaluateSupportOperationsReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const supportWorkflowPlaceholder = {
    workflowId: 'future-support-operations-workflow',
    implemented: false,
    ticketingIntegrated: false,
    userAccountsRequired: false,
    billingRequired: false,
    steps: ['triage', 'paper-mode-safety-check', 'incident-escalation-review', 'operator-runbook-reference', 'resolution-summary'],
  }
  const operatorSupportRunbookSummary = supportSummary(
    'operator-support-runbook',
    'Operator support runbook summary',
    input.productionOperationsRunbook?.operatorHandoffSummary?.handoffStatus,
    input.productionOperationsRunbook?.eventType,
    {
      checklistCount: (input.productionOperationsRunbook?.startupChecklistSummary?.length ?? 0)
        + (input.productionOperationsRunbook?.incidentResponseChecklist?.length ?? 0)
        + (input.productionOperationsRunbook?.rollbackReadinessChecklist?.length ?? 0),
    },
  )
  const customerSupportReadinessSummary = supportSummary(
    'customer-support-readiness',
    'Customer support readiness summary',
    input.customerOnboardingReadiness?.onboardingReadinessStatus,
    input.customerOnboardingReadiness?.eventType,
    {
      onboardingFlowImplemented: input.customerOnboardingReadiness?.onboardingFlowPlaceholder?.implemented === true,
      accountsRequired: false,
    },
  )
  const incidentSupportEscalationSummary = supportSummary(
    'incident-support-escalation',
    'Incident / support escalation summary',
    input.productionIncidentResponse?.incidentReadinessStatus,
    input.productionIncidentResponse?.eventType,
    {
      escalationRequired: input.productionIncidentResponse?.escalationPlanning?.escalationRequired === true,
      liveBrokerEscalation: false,
    },
  )
  const documentationReadinessSummary = supportSummary(
    'documentation-readiness',
    'Documentation readiness summary',
    input.productionMonitoringPlan?.monitoringReadinessStatus === 'blocked'
      || input.systemHealthCommandCenter?.finalPlatformHealthStatus === 'degraded'
      ? 'blocked'
      : input.productionMonitoringPlan?.monitoringReadinessStatus === 'ready'
        && input.productionOperationsRunbook?.operatorHandoffSummary?.handoffStatus === 'ready'
          ? 'ready'
          : 'caution',
    input.productionMonitoringPlan?.eventType ?? input.systemHealthCommandCenter?.eventType,
    {
      monitoringSignals: input.productionMonitoringPlan?.monitoringSignalCatalog?.length ?? 0,
      releaseControlStatus: input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown',
    },
  )
  const summaries = [
    operatorSupportRunbookSummary,
    customerSupportReadinessSummary,
    incidentSupportEscalationSummary,
    documentationReadinessSummary,
  ]
  const supportReadinessStatus = resolveSupportReadinessStatus(summaries)
  const result = {
    eventType: SYSTEM_SUPPORT_OPERATIONS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentTriggered: false,
    billingEnabled: false,
    paymentsEnabled: false,
    authenticationEnforced: false,
    userAccountsAdded: false,
    supportWorkflowPlaceholder,
    operatorSupportRunbookSummary,
    customerSupportReadinessSummary,
    incidentSupportEscalationSummary,
    documentationReadinessSummary,
    supportReadinessStatus,
    summary: `Support operations readiness ${supportReadinessStatus}: operator runbook, customer support, escalation, and documentation planning reviewed without accounts, billing, or broker execution.`,
    sourceEvents: {
      productionOperationsRunbook: input.productionOperationsRunbook?.eventType ?? null,
      customerOnboardingReadiness: input.customerOnboardingReadiness?.eventType ?? null,
      productionIncidentResponse: input.productionIncidentResponse?.eventType ?? null,
      productionMonitoringPlan: input.productionMonitoringPlan?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_SUPPORT_OPERATIONS_EVALUATED_EVENT, result)
  }
  return result
}

export function createSupportOperationsReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateSupportOperationsReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
