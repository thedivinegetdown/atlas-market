import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_ACTION_ITEMS_TRACKED_EVENT = 'system.complianceActionItems.tracked'

export const ACTION_ITEM_STATUSES = Object.freeze(['open', 'in_review', 'resolved', 'blocked'])
export const ACTION_ITEM_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return ACTION_ITEM_STATUSES.includes(status) ? status : 'open'
}

function safePriority(priority) {
  return ACTION_ITEM_PRIORITIES.includes(priority) ? priority : 'medium'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceGovernanceActionItem(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-action-item-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    actionStatus: safeStatus(input.actionStatus ?? input.status),
    actionPriority: safePriority(input.actionPriority ?? input.priority),
    dueDate: input.dueDate ?? null,
    actionSummary: String(input.actionSummary ?? 'Compliance governance action item prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    ownerRole: input.ownerRole ?? 'owner-admin',
    createdByUserId: input.createdByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticResolution: false,
    automaticAssignment: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceGovernanceActionItemRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(actionInput) {
      const actionItem = normalizeComplianceGovernanceActionItem(actionInput)
      if (!database?.connected) return { ok: true, disabled: true, actionItem }
      const result = await database.query(
        `INSERT INTO atlas_compliance_governance_action_items
          (id, organization_id, team_workspace_id, action_status, action_priority, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET action_status = EXCLUDED.action_status, action_priority = EXCLUDED.action_priority, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [actionItem.id, actionItem.tenantScope.organizationId, actionItem.tenantScope.teamWorkspaceId, actionItem.actionStatus, actionItem.actionPriority, actionItem.dueDate, actionItem],
      )
      return { ok: true, actionItem: normalizeComplianceGovernanceActionItem(result.rows?.[0]?.payload ?? actionItem) }
    },
    async list({ tenantContext = {}, actionStatus, actionPriority, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (actionStatus) {
        params.push(safeStatus(actionStatus))
        clauses.push(`action_status = $${params.length}`)
      }
      if (actionPriority) {
        params.push(safePriority(actionPriority))
        clauses.push(`action_priority = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_governance_action_items
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceGovernanceActionItem(row.payload))
    },
  }
}

export function trackComplianceGovernanceActionItems(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceGovernanceActionItems ?? []
  const minutes = input.complianceMeetingMinutes ?? {}
  const retentionReview = input.complianceRecordRetentionReview ?? {}
  const examReadiness = input.complianceExamReadiness ?? {}
  const priority = examReadiness.examReadinessStatus === 'blocked' ? 'critical' : retentionReview.retentionReviewStatus === 'caution' ? 'high' : 'medium'
  const actionItems = (supplied.length ? supplied : [normalizeComplianceGovernanceActionItem({
    tenantContext,
    actionStatus: priority === 'critical' ? 'blocked' : 'open',
    actionPriority: priority,
    actionSummary: `Compliance action item tracks follow-up from meeting minutes, retention review status ${retentionReview.retentionReviewStatus ?? 'unknown'}, and exam readiness ${examReadiness.examReadinessStatus ?? 'unknown'}.`,
    sourceReferences: [
      { id: 'compliance-meeting-minutes', type: 'compliance-meeting-minutes', eventType: minutes.eventType },
      { id: 'compliance-record-retention', type: 'compliance-record-retention-review', eventType: retentionReview.eventType },
      { id: 'compliance-exam-readiness', type: 'compliance-exam-readiness', eventType: examReadiness.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceGovernanceActionItem)
  const actionItemSummary = {
    total: actionItems.length,
    open: actionItems.filter((item) => item.actionStatus === 'open').length,
    inReview: actionItems.filter((item) => item.actionStatus === 'in_review').length,
    resolved: actionItems.filter((item) => item.actionStatus === 'resolved').length,
    blocked: actionItems.filter((item) => item.actionStatus === 'blocked').length,
    highPriority: actionItems.filter((item) => ['high', 'critical'].includes(item.actionPriority)).length,
  }
  const actionItemStatus = actionItemSummary.blocked > 0 ? 'blocked' : actionItemSummary.highPriority > 0 || actionItemSummary.open > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_ACTION_ITEMS_TRACKED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceGovernanceActionItems: actionItems,
    actionItemSummary,
    actionItemStatus,
    humanReviewOnly: true,
    automaticResolution: false,
    automaticAssignment: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance action items ${actionItemStatus}: ${actionItemSummary.open} open, ${actionItemSummary.blocked} blocked, and ${actionItemSummary.highPriority} high priority.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_ACTION_ITEMS_TRACKED_EVENT, result)
  return result
}
