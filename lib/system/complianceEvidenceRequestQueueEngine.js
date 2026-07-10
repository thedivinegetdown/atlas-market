import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_QUEUED_EVENT = 'system.complianceEvidenceRequest.queued'
export const SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_UPDATED_EVENT = 'system.complianceEvidenceRequest.updated'

export const EVIDENCE_REQUEST_STATUSES = Object.freeze(['open', 'in_progress', 'fulfilled', 'needs_clarification', 'closed'])
export const EVIDENCE_REQUEST_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return EVIDENCE_REQUEST_STATUSES.includes(status) ? status : 'open'
}

function safePriority(priority) {
  return EVIDENCE_REQUEST_PRIORITIES.includes(priority) ? priority : 'medium'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

export function normalizeComplianceEvidenceRequest(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-evidence-request-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    requestStatus: safeStatus(input.requestStatus ?? input.status),
    requestPriority: safePriority(input.requestPriority ?? input.priority),
    requestSummary: String(input.requestSummary ?? 'Evidence request queued for human-reviewed compliance package completion.').slice(0, 500),
    obligationReferences: (input.obligationReferences ?? []).map(normalizeReference),
    evidencePackageReferences: (input.evidencePackageReferences ?? []).map(normalizeReference),
    reviewWorkflowReferences: (input.reviewWorkflowReferences ?? []).map(normalizeReference),
    requestedEvidenceTypes: (input.requestedEvidenceTypes ?? ['administrative-evidence']).map((item) => String(item).slice(0, 80)),
    assignedUserId: input.assignedUserId ?? null,
    requestedByUserId: input.requestedByUserId ?? tenantScope.userId ?? null,
    dueDate: input.dueDate ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticEvidenceCollection: false,
    automaticEvidenceExport: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceEvidenceRequestRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(requestInput) {
      const request = normalizeComplianceEvidenceRequest(requestInput)
      if (!database?.connected) return { ok: true, disabled: true, request }
      const result = await database.query(
        `INSERT INTO atlas_compliance_evidence_requests
          (id, organization_id, team_workspace_id, request_status, request_priority, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET request_status = EXCLUDED.request_status, request_priority = EXCLUDED.request_priority, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [request.id, request.tenantScope.organizationId, request.tenantScope.teamWorkspaceId, request.requestStatus, request.requestPriority, request.dueDate, request],
      )
      return { ok: true, request: normalizeComplianceEvidenceRequest(result.rows?.[0]?.payload ?? request) }
    },
    async list({ tenantContext = {}, requestStatus, requestPriority, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (requestStatus) {
        params.push(safeStatus(requestStatus))
        clauses.push(`request_status = $${params.length}`)
      }
      if (requestPriority) {
        params.push(safePriority(requestPriority))
        clauses.push(`request_priority = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_evidence_requests
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceEvidenceRequest(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, requestStatus }) {
      const status = safeStatus(requestStatus)
      if (!database?.connected) return { ok: true, disabled: true, request: normalizeComplianceEvidenceRequest({ id, tenantContext, requestStatus: status }) }
      const result = await database.query(
        `UPDATE atlas_compliance_evidence_requests
         SET request_status = $4,
             payload = jsonb_set(payload, '{requestStatus}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', status],
      )
      return { ok: result.rows?.length > 0, request: result.rows?.[0]?.payload ? normalizeComplianceEvidenceRequest(result.rows[0].payload) : null }
    },
  }
}

export function queueComplianceEvidenceRequests(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const obligations = input.complianceObligationMapping?.complianceObligations ?? []
  const packages = input.complianceEvidencePackage?.complianceEvidencePackages ?? []
  const workflows = input.complianceReviewWorkflow?.complianceReviewWorkflows ?? []
  const supplied = input.complianceEvidenceRequests ?? []
  const requests = (supplied.length ? supplied : obligations.filter((item) => item.obligationStatus === 'needs_evidence' || item.evidenceCoverageScore < 0.8).map((obligation) => normalizeComplianceEvidenceRequest({
    tenantContext,
    id: `compliance-evidence-request-${obligation.id}`,
    requestStatus: 'open',
    requestPriority: obligation.evidenceCoverageScore < 0.5 ? 'high' : 'medium',
    requestSummary: `Evidence request opened for ${obligation.obligationDomain} obligation coverage review.`,
    obligationReferences: [{ id: obligation.id, type: 'compliance-obligation', eventType: input.complianceObligationMapping?.eventType }],
    evidencePackageReferences: packages.map((item) => ({ id: item.id, type: 'compliance-evidence-package', eventType: input.complianceEvidencePackage?.eventType })),
    reviewWorkflowReferences: workflows.map((item) => ({ id: item.id, type: 'compliance-review-workflow', eventType: input.complianceReviewWorkflow?.eventType })),
    requestedEvidenceTypes: obligation.requiredEvidenceTypes,
    timestamp: options.timestamp,
  }))).map(normalizeComplianceEvidenceRequest)
  const requestSummary = {
    total: requests.length,
    open: requests.filter((item) => item.requestStatus === 'open').length,
    inProgress: requests.filter((item) => item.requestStatus === 'in_progress').length,
    fulfilled: requests.filter((item) => item.requestStatus === 'fulfilled').length,
    needsClarification: requests.filter((item) => item.requestStatus === 'needs_clarification').length,
    highPriority: requests.filter((item) => ['high', 'critical'].includes(item.requestPriority)).length,
  }
  const queueStatus = requestSummary.needsClarification > 0 || requestSummary.highPriority > 0 ? 'caution' : requestSummary.open > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_QUEUED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceEvidenceRequests: requests,
    requestSummary,
    queueStatus,
    humanReviewOnly: true,
    automaticEvidenceCollection: false,
    automaticEvidenceExport: false,
    automaticComplianceClaims: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance evidence request queue ${queueStatus}: ${requestSummary.open} open and ${requestSummary.highPriority} high priority.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_QUEUED_EVENT, result)
  return result
}

export async function updateComplianceEvidenceRequestStatus(input = {}, options = {}) {
  const repository = options.repository ?? createComplianceEvidenceRequestRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    request: response.request,
    requestedStatus: safeStatus(input.requestStatus),
    status: response.ok ? 'updated' : 'blocked',
    automaticEvidenceCollection: false,
    automaticEvidenceExport: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_UPDATED_EVENT, result)
  return result
}
