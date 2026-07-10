import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_EXTERNAL_REVIEW_PLANNED_EVENT = 'system.complianceExternalReview.planned'

export const EXTERNAL_REVIEW_STATUSES = Object.freeze(['planned', 'ready_for_review', 'needs_updates', 'closed'])
export const EXTERNAL_REVIEW_TYPES = Object.freeze(['auditor', 'regulatory-exam', 'internal-review', 'customer-diligence'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return EXTERNAL_REVIEW_STATUSES.includes(status) ? status : 'planned'
}

function safeType(type) {
  return EXTERNAL_REVIEW_TYPES.includes(type) ? type : 'internal-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceExternalReviewRequest(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-external-review-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    requestType: safeType(input.requestType ?? input.type),
    requestStatus: safeStatus(input.requestStatus ?? input.status),
    dueDate: input.dueDate ?? input.dueAt ?? null,
    requestSummary: String(input.requestSummary ?? 'External review request planned for owner/admin review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    requiredReviewMaterials: (input.requiredReviewMaterials ?? []).map((item) => String(item).slice(0, 220)),
    boundarySummary: String(input.boundarySummary ?? 'Planning only; no external submission or distribution is performed by Atlas.').slice(0, 400),
    requestedByUserId: input.requestedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticSubmission: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    automaticApproval: false,
    automaticEnforcementActions: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceExternalReviewRequestRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(requestInput) {
      const reviewRequest = normalizeComplianceExternalReviewRequest(requestInput)
      if (!database?.connected) return { ok: true, disabled: true, reviewRequest }
      const result = await database.query(
        `INSERT INTO atlas_compliance_external_review_requests
          (id, organization_id, team_workspace_id, request_status, request_type, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET request_status = EXCLUDED.request_status, request_type = EXCLUDED.request_type, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          reviewRequest.id,
          reviewRequest.tenantScope.organizationId,
          reviewRequest.tenantScope.teamWorkspaceId,
          reviewRequest.requestStatus,
          reviewRequest.requestType,
          reviewRequest.dueDate,
          reviewRequest,
        ],
      )
      return { ok: true, reviewRequest: normalizeComplianceExternalReviewRequest(result.rows?.[0]?.payload ?? reviewRequest) }
    },
    async list({ tenantContext = {}, requestStatus, requestType, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (requestStatus) {
        params.push(safeStatus(requestStatus))
        clauses.push(`request_status = $${params.length}`)
      }
      if (requestType) {
        params.push(safeType(requestType))
        clauses.push(`request_type = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_external_review_requests
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceExternalReviewRequest(row.payload))
    },
  }
}

export function planComplianceExternalReviews(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceExternalReviewRequests ?? []
  const auditReadiness = input.complianceAuditReadinessPackage ?? {}
  const readout = input.complianceGovernanceReadout ?? {}
  const calendar = input.complianceReviewCalendar ?? {}
  const needsUpdates = (auditReadiness.auditReadinessSummary?.needsUpdates ?? 0) > 0
  const requests = (supplied.length ? supplied : [normalizeComplianceExternalReviewRequest({
    tenantContext,
    requestType: 'internal-review',
    requestStatus: needsUpdates ? 'needs_updates' : 'ready_for_review',
    requestSummary: `External review request plan references ${auditReadiness.auditReadinessSummary?.readyForReview ?? 0} audit readiness packages and ${readout.readoutSummary?.readyForReview ?? 0} governance readouts ready for owner/admin review.`,
    sourceReferences: [
      { id: 'compliance-audit-readiness', type: 'compliance-audit-readiness-package', eventType: auditReadiness.eventType },
      { id: 'compliance-governance-readout', type: 'compliance-governance-readout', eventType: readout.eventType },
      { id: 'compliance-review-calendar', type: 'compliance-review-calendar', eventType: calendar.eventType },
    ],
    requiredReviewMaterials: ['Audit readiness package', 'Governance readout', 'Evidence request status summary', 'Open finding summary'],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceExternalReviewRequest)
  const externalReviewSummary = {
    total: requests.length,
    planned: requests.filter((item) => item.requestStatus === 'planned').length,
    readyForReview: requests.filter((item) => item.requestStatus === 'ready_for_review').length,
    needsUpdates: requests.filter((item) => item.requestStatus === 'needs_updates').length,
    closed: requests.filter((item) => item.requestStatus === 'closed').length,
  }
  const externalReviewStatus = externalReviewSummary.needsUpdates > 0 ? 'caution' : externalReviewSummary.readyForReview > 0 ? 'ready' : 'caution'
  const result = {
    eventType: SYSTEM_COMPLIANCE_EXTERNAL_REVIEW_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceExternalReviewRequests: requests,
    externalReviewSummary,
    externalReviewStatus,
    humanReviewOnly: true,
    automaticSubmission: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    automaticApproval: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance external review planning ${externalReviewStatus}: ${externalReviewSummary.readyForReview} ready for review and ${externalReviewSummary.needsUpdates} needing updates.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_EXTERNAL_REVIEW_PLANNED_EVENT, result)
  return result
}
