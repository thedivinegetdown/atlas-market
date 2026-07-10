import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_RECORD_RETENTION_REVIEWED_EVENT = 'system.complianceRecordRetention.reviewed'

export const RECORD_RETENTION_REVIEW_STATUSES = Object.freeze(['current', 'review_due', 'needs_updates', 'archived'])
export const RECORD_RETENTION_DOMAINS = Object.freeze(['evidence', 'audit-readiness', 'external-review', 'governance-decision'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return RECORD_RETENTION_REVIEW_STATUSES.includes(status) ? status : 'current'
}

function safeDomain(domain) {
  return RECORD_RETENTION_DOMAINS.includes(domain) ? domain : 'evidence'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceRecordRetentionReview(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-record-retention-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    retentionDomain: safeDomain(input.retentionDomain ?? input.domain),
    reviewStatus: safeStatus(input.reviewStatus ?? input.status),
    reviewDueAt: input.reviewDueAt ?? input.dueDate ?? null,
    reviewSummary: String(input.reviewSummary ?? 'Compliance record retention review prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    retentionControls: (input.retentionControls ?? []).map((item) => String(item).slice(0, 220)),
    reviewedByUserId: input.reviewedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    reviewOnly: true,
    noDeletion: true,
    noMutation: true,
    automaticArchival: false,
    automaticComplianceClaims: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceRecordRetentionReviewRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(reviewInput) {
      const review = normalizeComplianceRecordRetentionReview(reviewInput)
      if (!database?.connected) return { ok: true, disabled: true, review }
      const result = await database.query(
        `INSERT INTO atlas_compliance_record_retention_reviews
          (id, organization_id, team_workspace_id, retention_domain, review_status, review_due_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET retention_domain = EXCLUDED.retention_domain, review_status = EXCLUDED.review_status, review_due_at = EXCLUDED.review_due_at, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [review.id, review.tenantScope.organizationId, review.tenantScope.teamWorkspaceId, review.retentionDomain, review.reviewStatus, review.reviewDueAt, review],
      )
      return { ok: true, review: normalizeComplianceRecordRetentionReview(result.rows?.[0]?.payload ?? review) }
    },
    async list({ tenantContext = {}, reviewStatus, retentionDomain, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (reviewStatus) {
        params.push(safeStatus(reviewStatus))
        clauses.push(`review_status = $${params.length}`)
      }
      if (retentionDomain) {
        params.push(safeDomain(retentionDomain))
        clauses.push(`retention_domain = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_record_retention_reviews
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceRecordRetentionReview(row.payload))
    },
  }
}

export function reviewComplianceRecordRetention(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceRecordRetentionReviews ?? []
  const evidenceGovernance = input.evidenceGovernance ?? {}
  const auditReadiness = input.complianceAuditReadinessPackage ?? {}
  const externalReview = input.complianceExternalReviewPlanning ?? {}
  const decisionLog = input.complianceGovernanceDecisionLog ?? {}
  const retentionDue = evidenceGovernance.governanceSummary?.retentionDue ?? 0
  const needsUpdates = retentionDue > 0 || auditReadiness.auditReadinessStatus === 'caution'
  const reviews = (supplied.length ? supplied : [normalizeComplianceRecordRetentionReview({
    tenantContext,
    retentionDomain: 'audit-readiness',
    reviewStatus: needsUpdates ? 'review_due' : 'current',
    reviewSummary: `Compliance retention review references ${retentionDue} evidence retention items due, ${auditReadiness.auditReadinessSummary?.total ?? 0} audit readiness packages, ${externalReview.externalReviewSummary?.total ?? 0} external review plans, and ${decisionLog.decisionSummary?.total ?? 0} governance decisions.`,
    sourceReferences: [
      { id: 'evidence-governance', type: 'evidence-governance', eventType: evidenceGovernance.eventType },
      { id: 'compliance-audit-readiness', type: 'compliance-audit-readiness-package', eventType: auditReadiness.eventType },
      { id: 'compliance-external-review', type: 'compliance-external-review-planning', eventType: externalReview.eventType },
      { id: 'compliance-governance-decision', type: 'compliance-governance-decision-log', eventType: decisionLog.eventType },
    ],
    retentionControls: ['Review retention classification', 'Confirm record references', 'Document owner/admin review outcome'],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceRecordRetentionReview)
  const retentionReviewSummary = {
    total: reviews.length,
    current: reviews.filter((item) => item.reviewStatus === 'current').length,
    reviewDue: reviews.filter((item) => item.reviewStatus === 'review_due').length,
    needsUpdates: reviews.filter((item) => item.reviewStatus === 'needs_updates').length,
    archived: reviews.filter((item) => item.reviewStatus === 'archived').length,
  }
  const retentionReviewStatus = retentionReviewSummary.needsUpdates > 0 || retentionReviewSummary.reviewDue > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_RECORD_RETENTION_REVIEWED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceRecordRetentionReviews: reviews,
    retentionReviewSummary,
    retentionReviewStatus,
    reviewOnly: true,
    noDeletion: true,
    noMutation: true,
    automaticArchival: false,
    automaticComplianceClaims: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance record retention ${retentionReviewStatus}: ${retentionReviewSummary.current} current and ${retentionReviewSummary.reviewDue} due for review.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_RECORD_RETENTION_REVIEWED_EVENT, result)
  return result
}
