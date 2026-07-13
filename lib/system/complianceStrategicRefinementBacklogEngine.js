import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_REFINEMENT_BACKLOG_PRIORITIZED_EVENT = 'system.complianceStrategicRefinementBacklog.prioritized'
export const STRATEGIC_REFINEMENT_STATUSES = Object.freeze(['prioritized', 'watch', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_REFINEMENT_STATUSES.includes(status) ? status : 'watch'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicRefinementBacklogItem(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-refinement-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    refinementStatus: safeStatus(input.refinementStatus ?? input.status),
    refinementScore: Math.max(0, Math.min(100, Number(input.refinementScore ?? 0))),
    refinementSummaryText: String(input.refinementSummaryText ?? input.refinementSummary ?? 'Compliance strategic refinement backlog prioritized for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRefinement: false,
    automaticAssignment: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicRefinementBacklogRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const refinement = normalizeComplianceStrategicRefinementBacklogItem(input)
      if (!database?.connected) return { ok: true, disabled: true, refinement }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_refinement_backlog
          (id, organization_id, team_workspace_id, refinement_status, refinement_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET refinement_status = EXCLUDED.refinement_status, refinement_score = EXCLUDED.refinement_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [refinement.id, refinement.tenantScope.organizationId, refinement.tenantScope.teamWorkspaceId, refinement.refinementStatus, refinement.refinementScore, refinement],
      )
      return { ok: true, refinement: normalizeComplianceStrategicRefinementBacklogItem(result.rows?.[0]?.payload ?? refinement) }
    },
    async list({ tenantContext = {}, refinementStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (refinementStatus) {
        params.push(safeStatus(refinementStatus))
        clauses.push(`refinement_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_refinement_backlog
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicRefinementBacklogItem(row.payload))
    },
  }
}

export function prioritizeComplianceStrategicRefinementBacklog(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicRefinementBacklog ?? []
  const feedback = input.complianceStrategicFeedbackIntake ?? {}
  const effectiveness = input.complianceStrategicCommunicationEffectiveness ?? {}
  const actions = input.operatorActionCenter ?? {}
  const feedbackScore = feedback.strategicFeedbackSummary?.averageFeedbackScore ?? 0
  const effectivenessScore = effectiveness.communicationEffectivenessSummary?.averageEffectivenessScore ?? feedbackScore
  const actionPenalty = Math.min(25, Number(actions.platformActionSummary?.openActions ?? 0))
  const score = Math.max(0, Math.min(100, Math.round(((feedbackScore + effectivenessScore) / 2) - actionPenalty)))
  const refinementStatus = score >= 85 ? 'prioritized' : score >= 60 ? 'watch' : 'blocked'
  const refinements = (supplied.length ? supplied : [normalizeComplianceStrategicRefinementBacklogItem({
    tenantContext,
    refinementStatus,
    refinementScore: score,
    refinementSummaryText: `Compliance strategic refinement backlog references feedback score ${feedbackScore}, effectiveness score ${effectivenessScore}, and operator action penalty ${actionPenalty}.`,
    sourceReferences: [
      { id: 'compliance-strategic-feedback-intake', type: 'compliance-strategic-feedback-intake', eventType: feedback.eventType },
      { id: 'compliance-strategic-communication-effectiveness', type: 'compliance-strategic-communication-effectiveness', eventType: effectiveness.eventType },
      { id: 'operator-action-center', type: 'operator-action-center', eventType: actions.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicRefinementBacklogItem)
  const strategicRefinementSummary = {
    total: refinements.length,
    prioritized: refinements.filter((item) => item.refinementStatus === 'prioritized').length,
    watch: refinements.filter((item) => item.refinementStatus === 'watch').length,
    blocked: refinements.filter((item) => item.refinementStatus === 'blocked').length,
    averageRefinementScore: refinements.length ? Math.round(refinements.reduce((sum, item) => sum + item.refinementScore, 0) / refinements.length) : 0,
  }
  const strategicRefinementStatus = strategicRefinementSummary.blocked > 0 ? 'blocked' : strategicRefinementSummary.watch > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_REFINEMENT_BACKLOG_PRIORITIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicRefinementBacklog: refinements,
    strategicRefinementSummary,
    strategicRefinementStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRefinement: false,
    automaticAssignment: false,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic refinement backlog ${strategicRefinementStatus}: average refinement score ${strategicRefinementSummary.averageRefinementScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_REFINEMENT_BACKLOG_PRIORITIZED_EVENT, result)
  return result
}
