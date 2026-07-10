import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_OPERATOR_ATTENTION_PRIORITIZED_EVENT = 'system.operatorAttention.prioritized'

const SEVERITY_RANK = Object.freeze({ informational: 1, caution: 2, high: 3, critical: 4 })
const URGENCY_RANK = Object.freeze({ normal: 1, 'due-soon': 2, breached: 3 })

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function severityFrom(value) {
  if (['informational', 'caution', 'high', 'critical'].includes(value)) return value
  if (value === 'blocked') return 'critical'
  if (value === 'healthy') return 'informational'
  return 'caution'
}

function priorityScore({ severity = 'informational', urgency = 'normal', confidence = 0.75 }) {
  return Math.round(((SEVERITY_RANK[severity] ?? 1) * 20) + ((URGENCY_RANK[urgency] ?? 1) * 10) + (Number(confidence ?? 0.75) * 20))
}

function normalizeAttentionItem(input = {}) {
  const severity = severityFrom(input.severity)
  const urgency = ['normal', 'due-soon', 'breached'].includes(input.urgency) ? input.urgency : 'normal'
  const confidence = Math.min(1, Math.max(0, Number(input.confidence ?? 0.75)))
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `attention-${input.sourceType ?? 'source'}-${input.sourceId ?? Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    userScope: input.userScope ?? input.userId ?? tenantScope.userId ?? null,
    sourceType: input.sourceType ?? 'operator-intelligence',
    sourceEventReference: input.sourceEventReference ?? null,
    workflowReference: input.workflowReference ?? null,
    severity,
    urgency,
    dueState: input.dueState ?? urgency,
    confidence,
    priorityScore: priorityScore({ severity, urgency, confidence }),
    rationale: String(input.rationale ?? 'Operator review recommended.').slice(0, 500),
    humanReviewOnly: true,
    automaticDestructiveActions: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

function itemsFromDigest(digest = {}, tenantContext = {}) {
  const normalized = digest.normalizedNotificationDigest ?? digest
  const items = []
  if ((normalized.criticalCount ?? 0) > 0) {
    items.push(normalizeAttentionItem({
      id: 'attention-critical-notification-digest',
      tenantContext,
      sourceType: 'notification-digest',
      sourceEventReference: digest.eventType ?? 'system.notificationDigest.generated',
      severity: 'high',
      urgency: 'normal',
      confidence: 0.86,
      rationale: `${normalized.criticalCount} critical in-app notifications remain visible for operator review.`,
    }))
  }
  if ((normalized.unreadCount ?? 0) > 3) {
    items.push(normalizeAttentionItem({
      id: 'attention-unread-notification-volume',
      tenantContext,
      sourceType: 'notification-digest',
      sourceEventReference: digest.eventType ?? 'system.notificationDigest.generated',
      severity: 'caution',
      urgency: 'normal',
      confidence: 0.72,
      rationale: `${normalized.unreadCount} unread in-app notifications may require triage.`,
    }))
  }
  return items
}

function itemsFromRiskReview(review = {}, tenantContext = {}) {
  return (review.activityRiskFindings ?? []).map((finding) => normalizeAttentionItem({
    id: `attention-risk-${finding.id}`,
    tenantContext,
    sourceType: 'activity-risk-review',
    sourceEventReference: review.eventType ?? 'system.userActivityRiskReview.evaluated',
    severity: finding.severity,
    urgency: finding.severity === 'critical' ? 'breached' : finding.severity === 'high' ? 'due-soon' : 'normal',
    confidence: 0.82,
    rationale: finding.summary,
    workflowReference: finding.references?.[0] ?? null,
  }))
}

function itemsFromSla(sla = {}, tenantContext = {}) {
  return (sla.workflowSlaItems ?? []).filter((item) => item.slaStatus !== 'within-sla').map((item) => normalizeAttentionItem({
    id: `attention-sla-${item.workflowId}`,
    tenantContext,
    sourceType: 'workflow-sla',
    sourceEventReference: sla.eventType ?? 'system.administrationWorkflowSla.evaluated',
    workflowReference: item.workflowId,
    severity: item.slaStatus === 'breached' ? 'critical' : 'high',
    urgency: item.slaStatus,
    dueState: item.slaStatus,
    confidence: 0.9,
    rationale: `${item.category} workflow is ${item.slaStatus}; ${item.escalationPlanning}.`,
  }))
}

function itemsFromAccess(accessReview = {}, tenantContext = {}) {
  return (accessReview.reviewFindings ?? []).map((finding) => normalizeAttentionItem({
    id: `attention-access-${finding.id}`,
    tenantContext,
    sourceType: 'access-review',
    sourceEventReference: accessReview.eventType ?? 'system.accessReview.evaluated',
    severity: finding.severity,
    urgency: finding.severity === 'critical' ? 'breached' : 'normal',
    confidence: 0.78,
    rationale: finding.summary,
    workflowReference: finding.references?.[0] ?? null,
  }))
}

export function prioritizeOperatorAttention(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const queue = [
    ...itemsFromDigest(input.notificationDigest, tenantContext),
    ...itemsFromRiskReview(input.userActivityRiskReview, tenantContext),
    ...itemsFromSla(input.administrationWorkflowSla, tenantContext),
    ...itemsFromAccess(input.accessReview, tenantContext),
    ...(input.tenantOperationsHealth?.operationalStatus && input.tenantOperationsHealth.operationalStatus !== 'healthy'
      ? [normalizeAttentionItem({
          id: 'attention-tenant-health',
          tenantContext,
          sourceType: 'tenant-health',
          sourceEventReference: input.tenantOperationsHealth.eventType,
          severity: input.tenantOperationsHealth.operationalStatus === 'blocked' ? 'critical' : 'caution',
          urgency: input.tenantOperationsHealth.operationalStatus === 'blocked' ? 'breached' : 'normal',
          confidence: 0.84,
          rationale: input.tenantOperationsHealth.summary,
        })]
      : []),
  ].sort((left, right) => right.priorityScore - left.priorityScore)

  const result = {
    eventType: SYSTEM_OPERATOR_ATTENTION_PRIORITIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    rankedOperatorAttentionQueue: queue.map((item, index) => ({ ...item, rank: index + 1 })),
    attentionSummary: {
      total: queue.length,
      critical: queue.filter((item) => item.severity === 'critical').length,
      high: queue.filter((item) => item.severity === 'high').length,
      breached: queue.filter((item) => item.dueState === 'breached').length,
    },
    humanReviewOnly: true,
    automaticDestructiveActions: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    status: queue.some((item) => item.severity === 'critical') ? 'blocked' : queue.length > 0 ? 'caution' : 'healthy',
    summary: `Operator attention queue prepared with ${queue.length} ranked human-review items.`,
    sourceEvents: {
      notificationDigest: input.notificationDigest?.eventType ?? null,
      userActivityRiskReview: input.userActivityRiskReview?.eventType ?? null,
      administrationWorkflowSla: input.administrationWorkflowSla?.eventType ?? null,
      tenantAdministrationWorkflow: input.tenantAdministrationWorkflow?.eventType ?? null,
      accessReview: input.accessReview?.eventType ?? null,
      sessionSecurity: input.sessionSecurity?.eventType ?? null,
      tenantOperationsHealth: input.tenantOperationsHealth?.eventType ?? null,
      administrativeAudit: input.administrativeAudit?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_OPERATOR_ATTENTION_PRIORITIZED_EVENT, result)
  return result
}
