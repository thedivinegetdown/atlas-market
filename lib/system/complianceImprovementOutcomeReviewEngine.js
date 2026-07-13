import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_IMPROVEMENT_OUTCOME_REVIEWED_EVENT = 'system.complianceImprovementOutcome.reviewed'
export const IMPROVEMENT_OUTCOME_STATUSES = Object.freeze(['reviewed', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return IMPROVEMENT_OUTCOME_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceImprovementOutcomeReview(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-improvement-outcome-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    outcomeStatus: safeStatus(input.outcomeStatus ?? input.status),
    outcomeScore: Math.max(0, Math.min(100, Number(input.outcomeScore ?? 0))),
    outcomeSummaryText: String(input.outcomeSummaryText ?? input.outcomeSummary ?? 'Compliance improvement outcome reviewed for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticOutcomeClaim: false,
    automaticClosure: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceImprovementOutcomeReviewRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const review = normalizeComplianceImprovementOutcomeReview(input)
      if (!database?.connected) return { ok: true, disabled: true, review }
      const result = await database.query(
        `INSERT INTO atlas_compliance_improvement_outcome_reviews
          (id, organization_id, team_workspace_id, outcome_status, outcome_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET outcome_status = EXCLUDED.outcome_status, outcome_score = EXCLUDED.outcome_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [review.id, review.tenantScope.organizationId, review.tenantScope.teamWorkspaceId, review.outcomeStatus, review.outcomeScore, review],
      )
      return { ok: true, review: normalizeComplianceImprovementOutcomeReview(result.rows?.[0]?.payload ?? review) }
    },
    async list({ tenantContext = {}, outcomeStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (outcomeStatus) {
        params.push(safeStatus(outcomeStatus))
        clauses.push(`outcome_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_improvement_outcome_reviews
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceImprovementOutcomeReview(row.payload))
    },
  }
}

export function reviewComplianceImprovementOutcomes(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceImprovementOutcomeReviews ?? []
  const monitoring = input.complianceAdoptionMonitoring ?? {}
  const backlog = input.complianceImprovementBacklog ?? {}
  const monitoringScore = monitoring.monitoringSummary?.averageMonitoringScore ?? 0
  const backlogScore = backlog.backlogSummary?.averageBacklogScore ?? monitoringScore
  const score = Math.max(0, Math.min(100, Math.round((monitoringScore + backlogScore) / 2)))
  const outcomeStatus = score >= 85 ? 'reviewed' : score >= 60 ? 'needs-review' : 'blocked'
  const reviews = (supplied.length ? supplied : [normalizeComplianceImprovementOutcomeReview({
    tenantContext,
    outcomeStatus,
    outcomeScore: score,
    outcomeSummaryText: `Compliance improvement outcome review references monitoring score ${monitoringScore} and backlog score ${backlogScore}.`,
    sourceReferences: [
      { id: 'compliance-adoption-monitoring', type: 'compliance-adoption-monitoring', eventType: monitoring.eventType },
      { id: 'compliance-improvement-backlog', type: 'compliance-improvement-backlog', eventType: backlog.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceImprovementOutcomeReview)
  const outcomeSummary = {
    total: reviews.length,
    reviewed: reviews.filter((item) => item.outcomeStatus === 'reviewed').length,
    needsReview: reviews.filter((item) => item.outcomeStatus === 'needs-review').length,
    blocked: reviews.filter((item) => item.outcomeStatus === 'blocked').length,
    averageOutcomeScore: reviews.length ? Math.round(reviews.reduce((sum, item) => sum + item.outcomeScore, 0) / reviews.length) : 0,
  }
  const improvementOutcomeStatus = outcomeSummary.blocked > 0 ? 'blocked' : outcomeSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_IMPROVEMENT_OUTCOME_REVIEWED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceImprovementOutcomeReviews: reviews,
    outcomeSummary,
    improvementOutcomeStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticOutcomeClaim: false,
    automaticClosure: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance improvement outcome review ${improvementOutcomeStatus}: average outcome score ${outcomeSummary.averageOutcomeScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_IMPROVEMENT_OUTCOME_REVIEWED_EVENT, result)
  return result
}
