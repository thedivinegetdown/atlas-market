import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_REMEDIATION_PLAN_CREATED_EVENT = 'system.remediationPlan.created'
export const SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT = 'system.remediationPlan.updated'

export const REMEDIATION_CATEGORIES = Object.freeze([
  'access review follow-up',
  'membership review',
  'invitation review',
  'session review',
  'notification configuration review',
  'tenant health follow-up',
  'access certification follow-up',
  'workflow backlog review',
  'documentation request',
  'general administrative investigation',
])
export const APPROVAL_STATUSES = Object.freeze(['draft', 'pending_approval', 'approved', 'rejected', 'changes_requested'])
export const EXECUTION_STATUSES = Object.freeze(['not_started', 'in_progress', 'blocked', 'completed', 'cancelled'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeCategory(category) {
  return REMEDIATION_CATEGORIES.includes(category) ? category : 'general administrative investigation'
}

function safeApproval(status) {
  return APPROVAL_STATUSES.includes(status) ? status : 'draft'
}

function safeExecution(status) {
  return EXECUTION_STATUSES.includes(status) ? status : 'not_started'
}

function priorityFrom(severity) {
  if (severity === 'critical') return 'critical'
  if (severity === 'high') return 'high'
  if (severity === 'caution') return 'medium'
  return 'low'
}

function categoryFromEvidence(evidence = {}) {
  if (evidence.evidenceType === 'session') return 'session review'
  if (evidence.evidenceType === 'access') return 'access review follow-up'
  if (evidence.evidenceType === 'certification') return 'access certification follow-up'
  if (evidence.evidenceType === 'notification') return 'notification configuration review'
  if (evidence.evidenceType === 'workflow-sla') return 'workflow backlog review'
  if (evidence.evidenceType === 'tenant-health') return 'tenant health follow-up'
  return 'general administrative investigation'
}

function safeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    type: reference.evidenceType ?? reference.type ?? 'evidence',
    eventType: reference.sourceEventReference?.eventType ?? reference.eventType ?? null,
  }
}

export function normalizeRemediationPlan(input = {}) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `remediation-plan-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(timestamp) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    relatedCaseId: input.relatedCaseId ?? null,
    relatedEvidenceReferences: (input.relatedEvidenceReferences ?? input.evidenceReferences ?? []).map(safeReference),
    planCategory: safeCategory(input.planCategory ?? input.category),
    priority: ['low', 'medium', 'high', 'critical'].includes(input.priority) ? input.priority : 'medium',
    ownerUserId: input.ownerUserId ?? tenantScope.userId ?? null,
    approverUserId: input.approverUserId ?? null,
    requestedActions: (input.requestedActions ?? ['operator review']).map((action) => String(action).slice(0, 160)),
    riskRationale: String(input.riskRationale ?? 'Human-reviewed administrative remediation plan.').slice(0, 500),
    expectedOutcome: String(input.expectedOutcome ?? 'Documented administrative review outcome.').slice(0, 300),
    dueDate: input.dueDate ?? null,
    approvalStatus: safeApproval(input.approvalStatus),
    executionStatus: safeExecution(input.executionStatus),
    reviewNotes: input.reviewNotes ? String(input.reviewNotes).slice(0, 500) : null,
    completionSummary: input.completionSummary ? String(input.completionSummary).slice(0, 500) : null,
    eventReferences: (input.eventReferences ?? []).map(safeReference),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    recommendationsOnly: true,
    humanReviewOnly: true,
    automaticRoleChanges: false,
    automaticSessionRevocation: false,
    automaticMembershipRemoval: false,
    automaticInvitationCancellation: false,
    automaticAccessCertificationChanges: false,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createRemediationPlanRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(planInput) {
      const plan = normalizeRemediationPlan(planInput)
      if (!database?.connected) return { ok: true, disabled: true, plan }
      const result = await database.query(
        `INSERT INTO atlas_remediation_plans
          (id, organization_id, team_workspace_id, related_case_id, approval_status, execution_status, priority, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET approval_status = EXCLUDED.approval_status, execution_status = EXCLUDED.execution_status, priority = EXCLUDED.priority, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [plan.id, plan.tenantScope.organizationId, plan.tenantScope.teamWorkspaceId, plan.relatedCaseId, plan.approvalStatus, plan.executionStatus, plan.priority, plan.dueDate, plan],
      )
      return { ok: true, plan: normalizeRemediationPlan(result.rows?.[0]?.payload ?? plan) }
    },
    async list({ tenantContext = {}, approvalStatus, executionStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (approvalStatus) {
        params.push(safeApproval(approvalStatus))
        clauses.push(`approval_status = $${params.length}`)
      }
      if (executionStatus) {
        params.push(safeExecution(executionStatus))
        clauses.push(`execution_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_remediation_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRemediationPlan(row.payload))
    },
    async get({ id, tenantContext = {} }) {
      if (!database?.connected) return null
      const result = await database.query(
        `SELECT payload FROM atlas_remediation_plans
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? ''],
      )
      return result.rows?.[0]?.payload ? normalizeRemediationPlan(result.rows[0].payload) : null
    },
    async updateApproval({ id, tenantContext = {}, approvalStatus, approverUserId, reviewNotes }) {
      const safe = safeApproval(approvalStatus)
      if (!database?.connected) return { ok: true, disabled: true, plan: normalizeRemediationPlan({ id, tenantContext, approvalStatus: safe, approverUserId, reviewNotes }) }
      const result = await database.query(
        `UPDATE atlas_remediation_plans
         SET approval_status = $4,
             payload = jsonb_set(jsonb_set(jsonb_set(payload, '{approvalStatus}', to_jsonb($4::text), true), '{approverUserId}', to_jsonb($5::text), true), '{reviewNotes}', to_jsonb($6::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', safe, approverUserId ?? '', reviewNotes ?? ''],
      )
      return { ok: result.rows?.length > 0, plan: result.rows?.[0]?.payload ? normalizeRemediationPlan(result.rows[0].payload) : null }
    },
    async updateExecution({ id, tenantContext = {}, executionStatus, completionSummary }) {
      const safe = safeExecution(executionStatus)
      if (!database?.connected) return { ok: true, disabled: true, plan: normalizeRemediationPlan({ id, tenantContext, executionStatus: safe, completionSummary }) }
      const result = await database.query(
        `UPDATE atlas_remediation_plans
         SET execution_status = $4,
             payload = jsonb_set(jsonb_set(payload, '{executionStatus}', to_jsonb($4::text), true), '{completionSummary}', to_jsonb($5::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', safe, completionSummary ?? ''],
      )
      return { ok: result.rows?.length > 0, plan: result.rows?.[0]?.payload ? normalizeRemediationPlan(result.rows[0].payload) : null }
    },
  }
}

export function buildRemediationPlans(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const evidence = input.administrativeEvidence?.administrativeEvidence ?? input.evidence ?? []
  const cases = input.administrativeCases?.administrativeCases ?? []
  const plans = evidence.slice(0, input.maxPlans ?? 5).map((item) => normalizeRemediationPlan({
    id: `remediation-plan-${item.id}`,
    tenantContext,
    relatedCaseId: item.relatedCaseId ?? cases[0]?.id ?? null,
    relatedEvidenceReferences: [item],
    planCategory: categoryFromEvidence(item),
    priority: priorityFrom(item.severity),
    ownerUserId: tenantContext.userId,
    requestedActions: [`Review ${item.evidenceType} evidence and document follow-up.`],
    riskRationale: item.safeSummary,
    expectedOutcome: 'Administrative owner/admin review completed without automated access mutation.',
    dueDate: item.severity === 'critical' ? options.timestamp ?? getNowIso() : null,
    approvalStatus: item.severity === 'critical' ? 'pending_approval' : 'draft',
    executionStatus: 'not_started',
    eventReferences: [item.sourceEventReference],
    timestamp: options.timestamp,
  }))
  const result = {
    eventType: plans.length > 0 ? SYSTEM_REMEDIATION_PLAN_CREATED_EVENT : SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    remediationPlans: plans,
    remediationSummary: {
      total: plans.length,
      draft: plans.filter((plan) => plan.approvalStatus === 'draft').length,
      pendingApproval: plans.filter((plan) => plan.approvalStatus === 'pending_approval').length,
      approvedAwaitingExecution: plans.filter((plan) => plan.approvalStatus === 'approved' && plan.executionStatus === 'not_started').length,
      blocked: plans.filter((plan) => plan.executionStatus === 'blocked').length,
      completed: plans.filter((plan) => plan.executionStatus === 'completed').length,
      overdue: plans.filter((plan) => plan.dueDate && !['completed', 'cancelled'].includes(plan.executionStatus)).length,
    },
    recommendationsOnly: true,
    humanReviewOnly: true,
    dashboardExecution: false,
    automaticRoleChanges: false,
    automaticSessionRevocation: false,
    automaticMembershipRemoval: false,
    automaticInvitationCancellation: false,
    automaticAccessCertificationChanges: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    status: plans.some((plan) => plan.priority === 'critical') ? 'caution' : 'healthy',
    summary: `Remediation planning prepared ${plans.length} human-reviewed recommendation plans.`,
    sourceEvents: {
      administrativeEvidence: input.administrativeEvidence?.eventType ?? null,
      administrativeCases: input.administrativeCases?.eventType ?? null,
      operatorAttention: input.operatorAttention?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(result.eventType, result)
  return result
}

export async function createRemediationPlan(input = {}, options = {}) {
  const repository = options.repository ?? createRemediationPlanRepository(options)
  const response = await repository.create(input.plan ?? input)
  const result = {
    eventType: SYSTEM_REMEDIATION_PLAN_CREATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    remediationPlan: response.plan,
    status: response.ok ? 'created' : 'blocked',
    recommendationsOnly: true,
    humanReviewOnly: true,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_REMEDIATION_PLAN_CREATED_EVENT, result)
  return result
}

export async function updateRemediationPlanApproval(input = {}, options = {}) {
  const repository = options.repository ?? createRemediationPlanRepository(options)
  const response = await repository.updateApproval(input)
  const result = {
    eventType: SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    remediationPlan: response.plan,
    requestedApprovalStatus: safeApproval(input.approvalStatus),
    status: response.ok ? 'updated' : 'blocked',
    humanReviewOnly: true,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT, result)
  return result
}

export async function updateRemediationPlanExecution(input = {}, options = {}) {
  const repository = options.repository ?? createRemediationPlanRepository(options)
  const response = await repository.updateExecution(input)
  const result = {
    eventType: SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    remediationPlan: response.plan,
    requestedExecutionStatus: safeExecution(input.executionStatus),
    status: response.ok ? 'updated' : 'blocked',
    humanReviewOnly: true,
    dashboardExecution: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT, result)
  return result
}
