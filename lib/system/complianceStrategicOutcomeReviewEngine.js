import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_OUTCOME_REVIEWED_EVENT = 'system.complianceStrategicOutcome.reviewed'
export const STRATEGIC_OUTCOME_STATUSES = Object.freeze(['validated', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_OUTCOME_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicOutcomeReview(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-outcome-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    outcomeStatus: safeStatus(input.outcomeStatus ?? input.status),
    outcomeScore: Math.max(0, Math.min(100, Number(input.outcomeScore ?? 0))),
    outcomeSummaryText: String(input.outcomeSummaryText ?? input.outcomeSummary ?? 'Compliance strategic outcome reviewed for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticOutcomeClaim: false,
    automaticStrategyChange: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicOutcomeReviewRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const outcome = normalizeComplianceStrategicOutcomeReview(input)
      if (!database?.connected) return { ok: true, disabled: true, outcome }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_outcome_reviews
          (id, organization_id, team_workspace_id, outcome_status, outcome_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET outcome_status = EXCLUDED.outcome_status, outcome_score = EXCLUDED.outcome_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [outcome.id, outcome.tenantScope.organizationId, outcome.tenantScope.teamWorkspaceId, outcome.outcomeStatus, outcome.outcomeScore, outcome],
      )
      return { ok: true, outcome: normalizeComplianceStrategicOutcomeReview(result.rows?.[0]?.payload ?? outcome) }
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
        `SELECT payload FROM atlas_compliance_strategic_outcome_reviews
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicOutcomeReview(row.payload))
    },
  }
}

export function reviewComplianceStrategicOutcomes(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicOutcomeReviews ?? input.complianceStrategicOutcomeReview ?? []
  const adaptation = input.complianceStrategicAdaptationReadiness ?? {}
  const refinement = input.complianceStrategicRefinementBacklog ?? {}
  const effectiveness = input.complianceStrategicCommunicationEffectiveness ?? {}
  const adaptationScore = adaptation.strategicAdaptationSummary?.averageAdaptationScore ?? 0
  const refinementScore = refinement.strategicRefinementSummary?.averageRefinementScore ?? adaptationScore
  const effectivenessScore = effectiveness.communicationEffectivenessSummary?.averageEffectivenessScore ?? adaptationScore
  const score = Math.max(0, Math.min(100, Math.round((adaptationScore + refinementScore + effectivenessScore) / 3)))
  const outcomeStatus = score >= 85 ? 'validated' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const outcomes = (sourceItems.length ? sourceItems : [normalizeComplianceStrategicOutcomeReview({
    tenantContext,
    outcomeStatus,
    outcomeScore: score,
    outcomeSummaryText: `Compliance strategic outcome review references adaptation score ${adaptationScore}, refinement score ${refinementScore}, and communication effectiveness score ${effectivenessScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-adaptation-readiness', type: 'compliance-strategic-adaptation-readiness', eventType: adaptation.eventType },
      { id: 'compliance-strategic-refinement-backlog', type: 'compliance-strategic-refinement-backlog', eventType: refinement.eventType },
      { id: 'compliance-strategic-communication-effectiveness', type: 'compliance-strategic-communication-effectiveness', eventType: effectiveness.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicOutcomeReview)
  const strategicOutcomeSummary = {
    total: outcomes.length,
    validated: outcomes.filter((item) => item.outcomeStatus === 'validated').length,
    needsReview: outcomes.filter((item) => item.outcomeStatus === 'needs-review').length,
    blocked: outcomes.filter((item) => item.outcomeStatus === 'blocked').length,
    averageOutcomeScore: outcomes.length ? Math.round(outcomes.reduce((sum, item) => sum + item.outcomeScore, 0) / outcomes.length) : 0,
  }
  const strategicOutcomeStatus = strategicOutcomeSummary.blocked > 0 ? 'blocked' : strategicOutcomeSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_OUTCOME_REVIEWED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicOutcomeReviews: outcomes,
    strategicOutcomeSummary,
    strategicOutcomeStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticOutcomeClaim: false,
    automaticStrategyChange: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic outcome review ${strategicOutcomeStatus}: average outcome score ${strategicOutcomeSummary.averageOutcomeScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_OUTCOME_REVIEWED_EVENT, result)
  return result
}
