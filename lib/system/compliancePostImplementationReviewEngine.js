import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_POST_IMPLEMENTATION_REVIEWED_EVENT = 'system.compliancePostImplementationReview.reviewed'
export const POST_IMPLEMENTATION_STATUSES = Object.freeze(['effective', 'watchlist', 'ineffective'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return POST_IMPLEMENTATION_STATUSES.includes(status) ? status : 'watchlist'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeCompliancePostImplementationReview(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-post-implementation-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    reviewStatus: safeStatus(input.reviewStatus ?? input.status),
    reviewScore: Math.max(0, Math.min(100, Number(input.reviewScore ?? 0))),
    reviewSummaryText: String(input.reviewSummaryText ?? input.reviewSummary ?? 'Compliance post-implementation review prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticEffectivenessClaim: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createCompliancePostImplementationReviewRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const review = normalizeCompliancePostImplementationReview(input)
      if (!database?.connected) return { ok: true, disabled: true, review }
      const result = await database.query(
        `INSERT INTO atlas_compliance_post_implementation_reviews
          (id, organization_id, team_workspace_id, review_status, review_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET review_status = EXCLUDED.review_status, review_score = EXCLUDED.review_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [review.id, review.tenantScope.organizationId, review.tenantScope.teamWorkspaceId, review.reviewStatus, review.reviewScore, review],
      )
      return { ok: true, review: normalizeCompliancePostImplementationReview(result.rows?.[0]?.payload ?? review) }
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
        `SELECT payload FROM atlas_compliance_post_implementation_reviews
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeCompliancePostImplementationReview(row.payload))
    },
  }
}

export function reviewCompliancePostImplementation(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.compliancePostImplementationReviews ?? []
  const closure = input.complianceChangeClosureReadiness ?? {}
  const verification = input.complianceChangeVerification ?? {}
  const closureScore = closure.closureSummary?.averageClosureScore ?? 0
  const verificationScore = verification.verificationSummary?.averageVerificationScore ?? closureScore
  const score = Math.round((closureScore + verificationScore) / 2)
  const reviewStatus = score >= 88 ? 'effective' : score >= 65 ? 'watchlist' : 'ineffective'
  const reviews = (supplied.length ? supplied : [normalizeCompliancePostImplementationReview({
    tenantContext,
    reviewStatus,
    reviewScore: score,
    reviewSummaryText: `Compliance post-implementation review references closure score ${closureScore} and verification score ${verificationScore}.`,
    sourceReferences: [
      { id: 'compliance-change-closure-readiness', type: 'compliance-change-closure-readiness', eventType: closure.eventType },
      { id: 'compliance-change-verification', type: 'compliance-change-verification', eventType: verification.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeCompliancePostImplementationReview)
  const reviewSummary = {
    total: reviews.length,
    effective: reviews.filter((item) => item.reviewStatus === 'effective').length,
    watchlist: reviews.filter((item) => item.reviewStatus === 'watchlist').length,
    ineffective: reviews.filter((item) => item.reviewStatus === 'ineffective').length,
    averageReviewScore: reviews.length ? Math.round(reviews.reduce((sum, item) => sum + item.reviewScore, 0) / reviews.length) : 0,
  }
  const postImplementationReviewStatus = reviewSummary.ineffective > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_POST_IMPLEMENTATION_REVIEWED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    compliancePostImplementationReviews: reviews,
    reviewSummary,
    postImplementationReviewStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticEffectivenessClaim: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance post-implementation review ${postImplementationReviewStatus}: average review score ${reviewSummary.averageReviewScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_POST_IMPLEMENTATION_REVIEWED_EVENT, result)
  return result
}
