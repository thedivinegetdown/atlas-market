import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_IMPROVEMENT_OPPORTUNITY_IDENTIFIED_EVENT = 'system.complianceImprovementOpportunity.identified'
export const IMPROVEMENT_OPPORTUNITY_STATUSES = Object.freeze(['identified', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return IMPROVEMENT_OPPORTUNITY_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceImprovementOpportunity(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-improvement-opportunity-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    opportunityStatus: safeStatus(input.opportunityStatus ?? input.status),
    opportunityScore: Math.max(0, Math.min(100, Number(input.opportunityScore ?? 0))),
    opportunitySummaryText: String(input.opportunitySummaryText ?? input.opportunitySummary ?? 'Compliance improvement opportunity identified for human review.').slice(0, 700),
    recommendedReviewDomain: String(input.recommendedReviewDomain ?? 'compliance-change-governance').slice(0, 140),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRemediation: false,
    automaticPolicyUpdate: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceImprovementOpportunityRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const opportunity = normalizeComplianceImprovementOpportunity(input)
      if (!database?.connected) return { ok: true, disabled: true, opportunity }
      const result = await database.query(
        `INSERT INTO atlas_compliance_improvement_opportunities
          (id, organization_id, team_workspace_id, opportunity_status, opportunity_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET opportunity_status = EXCLUDED.opportunity_status, opportunity_score = EXCLUDED.opportunity_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [opportunity.id, opportunity.tenantScope.organizationId, opportunity.tenantScope.teamWorkspaceId, opportunity.opportunityStatus, opportunity.opportunityScore, opportunity],
      )
      return { ok: true, opportunity: normalizeComplianceImprovementOpportunity(result.rows?.[0]?.payload ?? opportunity) }
    },
    async list({ tenantContext = {}, opportunityStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (opportunityStatus) {
        params.push(safeStatus(opportunityStatus))
        clauses.push(`opportunity_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_improvement_opportunities
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceImprovementOpportunity(row.payload))
    },
  }
}

export function identifyComplianceImprovementOpportunities(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceImprovementOpportunities ?? []
  const lessons = input.complianceLessonsLearned ?? {}
  const governance = input.complianceChangeGovernanceSummary ?? {}
  const lessonScore = lessons.lessonSummary?.averageLessonScore ?? 0
  const governanceScore = governance.governanceSummary?.averageGovernanceScore ?? lessonScore
  const score = Math.max(0, Math.min(100, Math.round((lessonScore + governanceScore) / 2)))
  const opportunityStatus = score >= 85 ? 'identified' : score >= 60 ? 'needs-review' : 'blocked'
  const opportunities = (supplied.length ? supplied : [normalizeComplianceImprovementOpportunity({
    tenantContext,
    opportunityStatus,
    opportunityScore: score,
    opportunitySummaryText: `Compliance improvement opportunity references lesson score ${lessonScore} and governance score ${governanceScore}.`,
    sourceReferences: [
      { id: 'compliance-lessons-learned', type: 'compliance-lessons-learned', eventType: lessons.eventType },
      { id: 'compliance-change-governance-summary', type: 'compliance-change-governance-summary', eventType: governance.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceImprovementOpportunity)
  const opportunitySummary = {
    total: opportunities.length,
    identified: opportunities.filter((item) => item.opportunityStatus === 'identified').length,
    needsReview: opportunities.filter((item) => item.opportunityStatus === 'needs-review').length,
    blocked: opportunities.filter((item) => item.opportunityStatus === 'blocked').length,
    averageOpportunityScore: opportunities.length ? Math.round(opportunities.reduce((sum, item) => sum + item.opportunityScore, 0) / opportunities.length) : 0,
  }
  const improvementOpportunityStatus = opportunitySummary.blocked > 0 ? 'blocked' : opportunitySummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_IMPROVEMENT_OPPORTUNITY_IDENTIFIED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceImprovementOpportunities: opportunities,
    opportunitySummary,
    improvementOpportunityStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRemediation: false,
    automaticPolicyUpdate: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance improvement opportunities ${improvementOpportunityStatus}: average opportunity score ${opportunitySummary.averageOpportunityScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_IMPROVEMENT_OPPORTUNITY_IDENTIFIED_EVENT, result)
  return result
}
