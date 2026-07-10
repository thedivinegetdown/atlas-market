import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_EVALUATED_EVENT = 'system.complianceReviewWorkflow.evaluated'
export const SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_UPDATED_EVENT = 'system.complianceReviewWorkflow.updated'

export const REVIEW_STATUSES = Object.freeze(['draft', 'queued', 'in_review', 'changes_requested', 'approved_for_readiness', 'closed'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return REVIEW_STATUSES.includes(status) ? status : 'queued'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

export function normalizeComplianceReviewWorkflow(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-review-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    reviewStatus: safeStatus(input.reviewStatus ?? input.status),
    reviewOwnerUserId: input.reviewOwnerUserId ?? tenantScope.userId ?? null,
    approverUserId: input.approverUserId ?? null,
    evidencePackageReferences: (input.evidencePackageReferences ?? []).map(normalizeReference),
    readinessReference: normalizeReference(input.readinessReference ?? {}),
    reviewFindings: (input.reviewFindings ?? []).map((finding) => String(finding).slice(0, 180)),
    reviewRecommendation: input.reviewRecommendation ?? 'review',
    dueDate: input.dueDate ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticComplianceClaims: false,
    automaticEnforcementActions: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceReviewWorkflowRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(workflowInput) {
      const workflow = normalizeComplianceReviewWorkflow(workflowInput)
      if (!database?.connected) return { ok: true, disabled: true, workflow }
      const result = await database.query(
        `INSERT INTO atlas_compliance_review_workflows
          (id, organization_id, team_workspace_id, review_status, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET review_status = EXCLUDED.review_status, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [workflow.id, workflow.tenantScope.organizationId, workflow.tenantScope.teamWorkspaceId, workflow.reviewStatus, workflow.dueDate, workflow],
      )
      return { ok: true, workflow: normalizeComplianceReviewWorkflow(result.rows?.[0]?.payload ?? workflow) }
    },
    async list({ tenantContext = {}, reviewStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (reviewStatus) {
        params.push(safeStatus(reviewStatus))
        clauses.push(`review_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_review_workflows
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceReviewWorkflow(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, reviewStatus }) {
      const status = safeStatus(reviewStatus)
      if (!database?.connected) return { ok: true, disabled: true, workflow: normalizeComplianceReviewWorkflow({ id, tenantContext, reviewStatus: status }) }
      const result = await database.query(
        `UPDATE atlas_compliance_review_workflows
         SET review_status = $4,
             payload = jsonb_set(payload, '{reviewStatus}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', status],
      )
      return { ok: result.rows?.length > 0, workflow: result.rows?.[0]?.payload ? normalizeComplianceReviewWorkflow(result.rows[0].payload) : null }
    },
  }
}

export function evaluateComplianceReviewWorkflow(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const packages = input.complianceEvidencePackage?.complianceEvidencePackages ?? []
  const supplied = input.complianceReviewWorkflows ?? []
  const workflows = (supplied.length ? supplied : [normalizeComplianceReviewWorkflow({
    tenantContext,
    reviewStatus: packages.some((item) => item.packageStatus === 'needs_updates') ? 'changes_requested' : 'queued',
    evidencePackageReferences: packages.map((item) => ({ id: item.id, type: 'compliance-evidence-package', eventType: input.complianceEvidencePackage?.eventType })),
    readinessReference: { id: 'compliance-readiness-command', type: 'compliance-readiness', eventType: input.complianceReadinessCommandCenter?.eventType },
    reviewFindings: packages.some((item) => item.packageStatus === 'needs_updates') ? ['Evidence package requires updates before readiness review.'] : [],
    reviewRecommendation: input.complianceReadinessCommandCenter?.commandCenterStatus === 'blocked' ? 'revise' : 'review',
    timestamp: options.timestamp,
  })]).map(normalizeComplianceReviewWorkflow)
  const reviewSummary = {
    total: workflows.length,
    queued: workflows.filter((item) => item.reviewStatus === 'queued').length,
    inReview: workflows.filter((item) => item.reviewStatus === 'in_review').length,
    changesRequested: workflows.filter((item) => item.reviewStatus === 'changes_requested').length,
    approvedForReadiness: workflows.filter((item) => item.reviewStatus === 'approved_for_readiness').length,
    closed: workflows.filter((item) => item.reviewStatus === 'closed').length,
  }
  const workflowStatus = reviewSummary.changesRequested > 0 ? 'blocked' : reviewSummary.queued > 0 || reviewSummary.inReview > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceReviewWorkflows: workflows,
    reviewSummary,
    workflowStatus,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticComplianceClaims: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance review workflows ${workflowStatus}: ${reviewSummary.queued} queued and ${reviewSummary.changesRequested} with changes requested.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_EVALUATED_EVENT, result)
  return result
}

export async function updateComplianceReviewWorkflowStatus(input = {}, options = {}) {
  const repository = options.repository ?? createComplianceReviewWorkflowRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    workflow: response.workflow,
    requestedReviewStatus: safeStatus(input.reviewStatus),
    status: response.ok ? 'updated' : 'blocked',
    automaticApproval: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_UPDATED_EVENT, result)
  return result
}
