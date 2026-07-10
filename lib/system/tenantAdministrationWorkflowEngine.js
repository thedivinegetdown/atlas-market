import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_CREATED_EVENT = 'system.tenantAdministrationWorkflow.created'
export const SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_UPDATED_EVENT = 'system.tenantAdministrationWorkflow.updated'

export const TENANT_ADMINISTRATION_WORKFLOW_CATEGORIES = Object.freeze([
  'membership review',
  'invitation review',
  'session review',
  'access certification',
  'tenant health',
  'notification review',
])

export const TENANT_ADMINISTRATION_WORKFLOW_STATUSES = Object.freeze(['open', 'acknowledged', 'resolved', 'dismissed'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function categoryFromFinding(finding = {}) {
  const id = String(finding.id ?? '')
  if (id.includes('invitation')) return 'invitation review'
  if (id.includes('session')) return 'session review'
  if (id.includes('certification')) return 'access certification'
  if (id.includes('notification')) return 'notification review'
  if (id.includes('tenant')) return 'tenant health'
  return 'membership review'
}

function safeCategory(category) {
  return TENANT_ADMINISTRATION_WORKFLOW_CATEGORIES.includes(category) ? category : 'membership review'
}

function safeStatus(status) {
  return TENANT_ADMINISTRATION_WORKFLOW_STATUSES.includes(status) ? status : 'open'
}

function priorityFromSeverity(severity) {
  if (severity === 'critical') return 'high'
  if (['caution', 'high'].includes(severity)) return 'medium'
  return 'low'
}

export function normalizeTenantAdministrationWorkflow(input = {}) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const category = safeCategory(input.category)
  return {
    id: String(input.id ?? `tenant-workflow-${category.replace(/\s+/g, '-')}-${Date.parse(timestamp) || Date.now()}`),
    category,
    status: safeStatus(input.status),
    priority: ['low', 'medium', 'high', 'critical'].includes(input.priority) ? input.priority : priorityFromSeverity(input.severity),
    title: String(input.title ?? `${category} workflow`).slice(0, 160),
    summary: String(input.summary ?? 'Human operator review workflow.').slice(0, 500),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    assigneePlaceholder: input.assigneePlaceholder ?? input.assignee ?? null,
    dueDatePlaceholder: input.dueDatePlaceholder ?? input.dueDate ?? null,
    sourceFindingReferences: input.sourceFindingReferences ?? input.references ?? [],
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    humanReviewOnly: true,
    automaticRoleChanges: false,
    automaticMembershipRevocation: false,
    automaticSessionRevocation: false,
    automaticInvitationMutation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createTenantAdministrationWorkflowRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async upsert(workflowInput) {
      const workflow = normalizeTenantAdministrationWorkflow(workflowInput)
      if (!database?.connected) return { ok: true, disabled: true, workflow }
      const result = await database.query(
        `INSERT INTO atlas_tenant_administration_workflows
          (id, organization_id, team_workspace_id, category, status, priority, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET status = EXCLUDED.status, priority = EXCLUDED.priority, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          workflow.id,
          workflow.tenantScope.organizationId,
          workflow.tenantScope.teamWorkspaceId,
          workflow.category,
          workflow.status,
          workflow.priority,
          workflow,
        ],
      )
      return { ok: true, workflow: normalizeTenantAdministrationWorkflow(result.rows?.[0]?.payload ?? workflow) }
    },
    async list({ tenantContext = {}, status, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const statusClause = status ? 'AND status = $4' : ''
      if (status) params.push(status)
      const result = await database.query(
        `SELECT payload FROM atlas_tenant_administration_workflows
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${statusClause}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeTenantAdministrationWorkflow(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, status }) {
      const safe = safeStatus(status)
      if (!database?.connected) return { ok: true, disabled: true, workflow: normalizeTenantAdministrationWorkflow({ id, tenantContext, status: safe }) }
      const result = await database.query(
        `UPDATE atlas_tenant_administration_workflows
         SET status = $4,
             payload = jsonb_set(payload, '{status}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', safe],
      )
      return { ok: result.rows?.length > 0, workflow: result.rows?.[0]?.payload ? normalizeTenantAdministrationWorkflow(result.rows[0].payload) : null }
    },
  }
}

function workflowFromFinding(finding = {}, tenantContext = {}) {
  const category = categoryFromFinding(finding)
  return normalizeTenantAdministrationWorkflow({
    id: `tenant-workflow-${finding.id ?? category.replace(/\s+/g, '-')}`,
    category,
    priority: priorityFromSeverity(finding.severity),
    title: `${category}: ${finding.severity ?? 'informational'}`,
    summary: finding.summary ?? 'Finding requires human operator review.',
    tenantContext,
    sourceFindingReferences: finding.references ?? [finding.id].filter(Boolean),
  })
}

export function evaluateTenantAdministrationWorkflow(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const accessFindings = input.accessReview?.reviewFindings ?? []
  const notificationFindings = (input.inAppNotifications ?? input.notifications ?? [])
    .filter((notification) => notification.status === 'unread' || notification.severity === 'critical')
    .map((notification) => ({
      id: `notification-${notification.id}`,
      severity: notification.severity === 'critical' ? 'critical' : 'caution',
      summary: notification.message ?? notification.title ?? 'Notification requires review.',
      references: [notification.id],
    }))
  const healthFindings = ['blocked', 'caution'].includes(input.tenantOperationsHealth?.operationalStatus)
    ? [{ id: 'tenant-health-review', severity: input.tenantOperationsHealth.operationalStatus === 'blocked' ? 'critical' : 'caution', summary: input.tenantOperationsHealth.summary }]
    : []
  const certificationFindings = ['blocked', 'caution'].includes(input.accessCertification?.certificationStatus)
    ? [{ id: 'access-certification-review', severity: input.accessCertification.certificationStatus === 'blocked' ? 'critical' : 'caution', summary: input.accessCertification.summary }]
    : []
  const workflows = [...accessFindings, ...notificationFindings, ...healthFindings, ...certificationFindings]
    .map((finding) => workflowFromFinding(finding, tenantContext))
  const existing = input.existingWorkflows ?? []
  const allWorkflows = [...workflows, ...existing.map(normalizeTenantAdministrationWorkflow)]
  const repository = options.repository ?? null
  if (repository?.upsert) {
    for (const workflow of workflows) void repository.upsert(workflow)
  }
  const workflowSummary = {
    total: allWorkflows.length,
    open: allWorkflows.filter((workflow) => workflow.status === 'open').length,
    highPriority: allWorkflows.filter((workflow) => ['high', 'critical'].includes(workflow.priority)).length,
  }
  const result = {
    eventType: workflows.length > 0 ? SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_CREATED_EVENT : SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    workflowCategories: TENANT_ADMINISTRATION_WORKFLOW_CATEGORIES,
    workflowStatuses: TENANT_ADMINISTRATION_WORKFLOW_STATUSES,
    workflows: allWorkflows,
    workflowSummary,
    priorities: {
      high: allWorkflows.filter((workflow) => workflow.priority === 'high').length,
      medium: allWorkflows.filter((workflow) => workflow.priority === 'medium').length,
      low: allWorkflows.filter((workflow) => workflow.priority === 'low').length,
    },
    humanReviewOnly: true,
    automaticRoleChanges: false,
    automaticMembershipRevocation: false,
    automaticSessionRevocation: false,
    automaticInvitationMutation: false,
    status: workflowSummary.highPriority > 0 ? 'caution' : 'healthy',
    summary: `Tenant administration workflows ${workflowSummary.highPriority > 0 ? 'caution' : 'healthy'}: ${workflowSummary.total} human-review workflows prepared.`,
    sourceEvents: {
      accessReview: input.accessReview?.eventType ?? null,
      accessCertification: input.accessCertification?.eventType ?? null,
      collaborationGovernance: input.collaborationGovernance?.eventType ?? null,
      tenantOperationsHealth: input.tenantOperationsHealth?.eventType ?? null,
      inAppNotifications: input.inAppNotificationCenter?.eventType ?? null,
      operatorActions: input.operatorActions?.eventType ?? null,
    },
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(result.eventType, result)
  return result
}

export async function updateTenantAdministrationWorkflowStatus(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const repository = options.repository ?? createTenantAdministrationWorkflowRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    workflow: response.workflow,
    requestedStatus: safeStatus(input.status),
    status: response.ok ? 'updated' : 'blocked',
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_UPDATED_EVENT, result)
  return result
}
