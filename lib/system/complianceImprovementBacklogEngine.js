import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_IMPROVEMENT_BACKLOG_PRIORITIZED_EVENT = 'system.complianceImprovementBacklog.prioritized'
export const IMPROVEMENT_BACKLOG_STATUSES = Object.freeze(['prioritized', 'needs-review', 'blocked'])
export const IMPROVEMENT_BACKLOG_PRIORITIES = Object.freeze(['high', 'medium', 'low'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return IMPROVEMENT_BACKLOG_STATUSES.includes(status) ? status : 'needs-review'
}

function safePriority(priority) {
  return IMPROVEMENT_BACKLOG_PRIORITIES.includes(priority) ? priority : 'medium'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceImprovementBacklogItem(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-improvement-backlog-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    backlogStatus: safeStatus(input.backlogStatus ?? input.status),
    backlogPriority: safePriority(input.backlogPriority ?? input.priority),
    backlogScore: Math.max(0, Math.min(100, Number(input.backlogScore ?? 0))),
    backlogSummaryText: String(input.backlogSummaryText ?? input.backlogSummary ?? 'Compliance improvement backlog item prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticPrioritizationExecution: false,
    automaticAssignment: false,
    automaticRemediation: false,
    automaticPolicyUpdate: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceImprovementBacklogRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const item = normalizeComplianceImprovementBacklogItem(input)
      if (!database?.connected) return { ok: true, disabled: true, item }
      const result = await database.query(
        `INSERT INTO atlas_compliance_improvement_backlog_items
          (id, organization_id, team_workspace_id, backlog_status, backlog_priority, backlog_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET backlog_status = EXCLUDED.backlog_status, backlog_priority = EXCLUDED.backlog_priority, backlog_score = EXCLUDED.backlog_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [item.id, item.tenantScope.organizationId, item.tenantScope.teamWorkspaceId, item.backlogStatus, item.backlogPriority, item.backlogScore, item],
      )
      return { ok: true, item: normalizeComplianceImprovementBacklogItem(result.rows?.[0]?.payload ?? item) }
    },
    async list({ tenantContext = {}, backlogStatus, backlogPriority, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (backlogStatus) {
        params.push(safeStatus(backlogStatus))
        clauses.push(`backlog_status = $${params.length}`)
      }
      if (backlogPriority) {
        params.push(safePriority(backlogPriority))
        clauses.push(`backlog_priority = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_improvement_backlog_items
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceImprovementBacklogItem(row.payload))
    },
  }
}

export function prioritizeComplianceImprovementBacklog(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceImprovementBacklogItems ?? []
  const opportunities = input.complianceImprovementOpportunity ?? {}
  const adoption = input.complianceAdoptionReadiness ?? {}
  const opportunityScore = opportunities.opportunitySummary?.averageOpportunityScore ?? 0
  const adoptionScore = adoption.adoptionSummary?.averageAdoptionScore ?? opportunityScore
  const score = Math.max(0, Math.min(100, Math.round((opportunityScore + adoptionScore) / 2)))
  const backlogStatus = score >= 85 ? 'prioritized' : score >= 60 ? 'needs-review' : 'blocked'
  const backlogPriority = score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low'
  const items = (supplied.length ? supplied : [normalizeComplianceImprovementBacklogItem({
    tenantContext,
    backlogStatus,
    backlogPriority,
    backlogScore: score,
    backlogSummaryText: `Compliance improvement backlog references opportunity score ${opportunityScore} and adoption score ${adoptionScore}.`,
    sourceReferences: [
      { id: 'compliance-improvement-opportunities', type: 'compliance-improvement-opportunities', eventType: opportunities.eventType },
      { id: 'compliance-adoption-readiness', type: 'compliance-adoption-readiness', eventType: adoption.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceImprovementBacklogItem)
  const backlogSummary = {
    total: items.length,
    prioritized: items.filter((item) => item.backlogStatus === 'prioritized').length,
    needsReview: items.filter((item) => item.backlogStatus === 'needs-review').length,
    blocked: items.filter((item) => item.backlogStatus === 'blocked').length,
    highPriority: items.filter((item) => item.backlogPriority === 'high').length,
    averageBacklogScore: items.length ? Math.round(items.reduce((sum, item) => sum + item.backlogScore, 0) / items.length) : 0,
  }
  const improvementBacklogStatus = backlogSummary.blocked > 0 ? 'blocked' : backlogSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_IMPROVEMENT_BACKLOG_PRIORITIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceImprovementBacklogItems: items,
    backlogSummary,
    improvementBacklogStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticPrioritizationExecution: false,
    automaticAssignment: false,
    automaticRemediation: false,
    automaticPolicyUpdate: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance improvement backlog ${improvementBacklogStatus}: average backlog score ${backlogSummary.averageBacklogScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_IMPROVEMENT_BACKLOG_PRIORITIZED_EVENT, result)
  return result
}
