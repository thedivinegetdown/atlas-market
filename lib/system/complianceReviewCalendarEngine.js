import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_REVIEW_CALENDAR_GENERATED_EVENT = 'system.complianceReviewCalendar.generated'

export const CALENDAR_ITEM_STATUSES = Object.freeze(['scheduled', 'due_soon', 'overdue', 'completed', 'deferred'])
export const CALENDAR_ITEM_TYPES = Object.freeze(['review-workflow', 'evidence-request', 'review-finding', 'sla-review', 'escalation-review', 'attestation-renewal'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return CALENDAR_ITEM_STATUSES.includes(status) ? status : 'scheduled'
}

function safeType(type) {
  return CALENDAR_ITEM_TYPES.includes(type) ? type : 'review-workflow'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

function daysUntil(dueDate, now) {
  if (!dueDate) return 7
  const due = new Date(dueDate)
  const current = new Date(now)
  if (Number.isNaN(due.getTime()) || Number.isNaN(current.getTime())) return 7
  return Math.ceil((due.getTime() - current.getTime()) / 86_400_000)
}

function statusFromDueDate(dueDate, now) {
  const remaining = daysUntil(dueDate, now)
  if (remaining < 0) return 'overdue'
  if (remaining <= 7) return 'due_soon'
  return 'scheduled'
}

export function normalizeComplianceReviewCalendarItem(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-calendar-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    itemType: safeType(input.itemType ?? input.type),
    itemStatus: safeStatus(input.itemStatus ?? input.status),
    itemPriority: input.itemPriority ?? 'medium',
    title: String(input.title ?? 'Compliance review calendar item').slice(0, 180),
    dueDate: input.dueDate ?? null,
    ownerRole: input.ownerRole ?? 'admin',
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticScheduling: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceReviewCalendarRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(itemInput) {
      const item = normalizeComplianceReviewCalendarItem(itemInput)
      if (!database?.connected) return { ok: true, disabled: true, item }
      const result = await database.query(
        `INSERT INTO atlas_compliance_review_calendar_items
          (id, organization_id, team_workspace_id, item_type, item_status, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET item_type = EXCLUDED.item_type, item_status = EXCLUDED.item_status, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [item.id, item.tenantScope.organizationId, item.tenantScope.teamWorkspaceId, item.itemType, item.itemStatus, item.dueDate, item],
      )
      return { ok: true, item: normalizeComplianceReviewCalendarItem(result.rows?.[0]?.payload ?? item) }
    },
    async list({ tenantContext = {}, itemStatus, itemType, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (itemStatus) {
        params.push(safeStatus(itemStatus))
        clauses.push(`item_status = $${params.length}`)
      }
      if (itemType) {
        params.push(safeType(itemType))
        clauses.push(`item_type = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_review_calendar_items
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY due_date ASC NULLS LAST, updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceReviewCalendarItem(row.payload))
    },
  }
}

export function generateComplianceReviewCalendar(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceReviewCalendarItems ?? []
  const workflows = input.complianceReviewWorkflow?.complianceReviewWorkflows ?? []
  const slas = input.complianceReviewSla?.complianceReviewSlas ?? []
  const escalations = input.complianceEscalationPlanning?.complianceEscalationPlans ?? []
  const generated = [
    ...workflows.filter((item) => ['queued', 'in_review', 'changes_requested'].includes(item.reviewStatus)).map((workflow) => normalizeComplianceReviewCalendarItem({
      tenantContext,
      id: `compliance-calendar-${workflow.id}`,
      itemType: 'review-workflow',
      itemStatus: statusFromDueDate(workflow.dueDate, now),
      itemPriority: workflow.reviewStatus === 'changes_requested' ? 'high' : 'medium',
      title: 'Compliance review workflow follow-up',
      dueDate: workflow.dueDate,
      sourceReferences: [{ id: workflow.id, type: 'compliance-review-workflow', eventType: input.complianceReviewWorkflow?.eventType }],
      timestamp: now,
    })),
    ...slas.filter((item) => ['at_risk', 'breached'].includes(item.slaStatus)).map((sla) => normalizeComplianceReviewCalendarItem({
      tenantContext,
      id: `compliance-calendar-${sla.id}`,
      itemType: 'sla-review',
      itemStatus: sla.slaStatus === 'breached' ? 'overdue' : 'due_soon',
      itemPriority: sla.slaSeverity === 'critical' ? 'critical' : 'high',
      title: 'Compliance SLA review',
      dueDate: sla.dueDate,
      sourceReferences: [{ id: sla.id, type: 'compliance-review-sla', eventType: input.complianceReviewSla?.eventType }],
      timestamp: now,
    })),
    ...escalations.filter((item) => ['planned', 'in_review'].includes(item.escalationStatus)).map((plan) => normalizeComplianceReviewCalendarItem({
      tenantContext,
      id: `compliance-calendar-${plan.id}`,
      itemType: 'escalation-review',
      itemStatus: statusFromDueDate(plan.dueDate, now),
      itemPriority: plan.escalationSeverity,
      title: 'Compliance escalation review',
      dueDate: plan.dueDate,
      ownerRole: plan.recommendedOwnerRole,
      sourceReferences: [{ id: plan.id, type: 'compliance-escalation-plan', eventType: input.complianceEscalationPlanning?.eventType }],
      timestamp: now,
    })),
  ]
  const items = (supplied.length ? supplied : generated).map(normalizeComplianceReviewCalendarItem)
  const calendarSummary = {
    total: items.length,
    scheduled: items.filter((item) => item.itemStatus === 'scheduled').length,
    dueSoon: items.filter((item) => item.itemStatus === 'due_soon').length,
    overdue: items.filter((item) => item.itemStatus === 'overdue').length,
    escalationReviews: items.filter((item) => item.itemType === 'escalation-review').length,
  }
  const calendarStatus = calendarSummary.overdue > 0 ? 'blocked' : calendarSummary.dueSoon > 0 || calendarSummary.escalationReviews > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_REVIEW_CALENDAR_GENERATED_EVENT,
    timestamp: now,
    complianceReviewCalendarItems: items,
    calendarSummary,
    calendarStatus,
    humanReviewOnly: true,
    automaticScheduling: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance review calendar ${calendarStatus}: ${calendarSummary.dueSoon} due soon and ${calendarSummary.overdue} overdue.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_REVIEW_CALENDAR_GENERATED_EVENT, result)
  return result
}
