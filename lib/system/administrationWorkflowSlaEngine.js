import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { normalizeTenantAdministrationWorkflow } from './tenantAdministrationWorkflowEngine.js'

export const SYSTEM_ADMINISTRATION_WORKFLOW_SLA_EVALUATED_EVENT = 'system.administrationWorkflowSla.evaluated'

const SLA_TARGET_HOURS = Object.freeze({
  critical: 4,
  high: 8,
  medium: 24,
  low: 72,
})

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function hoursBetween(left, right) {
  const start = new Date(left).getTime()
  const end = new Date(right).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, (end - start) / 36e5)
}

function targetForPriority(priority) {
  return SLA_TARGET_HOURS[priority] ?? SLA_TARGET_HOURS.medium
}

function statusFrom(items) {
  if (items.some((item) => item.slaStatus === 'breached')) return 'blocked'
  if (items.some((item) => item.slaStatus === 'due-soon')) return 'caution'
  return 'healthy'
}

export function evaluateAdministrationWorkflowSla(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.now ?? input.now ?? getNowIso()
  const workflows = (input.workflows ?? input.tenantAdministrationWorkflow?.workflows ?? []).map(normalizeTenantAdministrationWorkflow)
  const openWorkflows = workflows.filter((workflow) => !['resolved', 'dismissed'].includes(workflow.status))
  const slaItems = openWorkflows.map((workflow) => {
    const ageHours = hoursBetween(workflow.createdAt, now)
    const targetHours = targetForPriority(workflow.priority)
    const slaStatus = ageHours > targetHours ? 'breached' : ageHours > targetHours * 0.75 ? 'due-soon' : 'within-sla'
    return {
      workflowId: workflow.id,
      category: workflow.category,
      priority: workflow.priority,
      status: workflow.status,
      ageHours: Number(ageHours.toFixed(2)),
      targetHours,
      slaStatus,
      escalationPlanning: slaStatus === 'breached' ? 'owner/admin review recommended' : slaStatus === 'due-soon' ? 'monitor before target breach' : 'no escalation needed',
      sourceFindingReferences: workflow.sourceFindingReferences,
    }
  })
  const workflowSlaStatus = statusFrom(slaItems)
  const result = {
    eventType: SYSTEM_ADMINISTRATION_WORKFLOW_SLA_EVALUATED_EVENT,
    timestamp: getNowIso(now),
    slaTargetHours: SLA_TARGET_HOURS,
    workflowSlaItems: slaItems,
    workflowSlaSummary: {
      totalOpen: openWorkflows.length,
      breached: slaItems.filter((item) => item.slaStatus === 'breached').length,
      dueSoon: slaItems.filter((item) => item.slaStatus === 'due-soon').length,
      withinSla: slaItems.filter((item) => item.slaStatus === 'within-sla').length,
    },
    workflowSlaStatus,
    escalationPlanningOnly: true,
    automaticWorkflowMutation: false,
    automaticMembershipRevocation: false,
    automaticSessionRevocation: false,
    automaticInvitationMutation: false,
    ownerAdminReviewBoundary: true,
    summary: `Administration workflow SLA ${workflowSlaStatus}: ${slaItems.length} open workflows reviewed for due-soon and breached targets.`,
    sourceEvents: {
      tenantAdministrationWorkflow: input.tenantAdministrationWorkflow?.eventType ?? null,
      operatorActions: input.operatorActions?.eventType ?? null,
      accessCertification: input.accessCertification?.eventType ?? null,
    },
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ADMINISTRATION_WORKFLOW_SLA_EVALUATED_EVENT, result)
  return result
}
