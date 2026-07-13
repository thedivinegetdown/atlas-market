import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_ADAPTATION_READINESS_EVALUATED_EVENT = 'system.complianceStrategicAdaptationReadiness.evaluated'
export const STRATEGIC_ADAPTATION_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_ADAPTATION_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicAdaptationReadiness(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-adaptation-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    adaptationStatus: safeStatus(input.adaptationStatus ?? input.status),
    adaptationScore: Math.max(0, Math.min(100, Number(input.adaptationScore ?? 0))),
    adaptationSummaryText: String(input.adaptationSummaryText ?? input.adaptationSummary ?? 'Compliance strategic adaptation readiness evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAdaptation: false,
    automaticStrategyChange: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicAdaptationReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const adaptation = normalizeComplianceStrategicAdaptationReadiness(input)
      if (!database?.connected) return { ok: true, disabled: true, adaptation }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_adaptation_readiness
          (id, organization_id, team_workspace_id, adaptation_status, adaptation_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET adaptation_status = EXCLUDED.adaptation_status, adaptation_score = EXCLUDED.adaptation_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [adaptation.id, adaptation.tenantScope.organizationId, adaptation.tenantScope.teamWorkspaceId, adaptation.adaptationStatus, adaptation.adaptationScore, adaptation],
      )
      return { ok: true, adaptation: normalizeComplianceStrategicAdaptationReadiness(result.rows?.[0]?.payload ?? adaptation) }
    },
    async list({ tenantContext = {}, adaptationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (adaptationStatus) {
        params.push(safeStatus(adaptationStatus))
        clauses.push(`adaptation_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_adaptation_readiness
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicAdaptationReadiness(row.payload))
    },
  }
}

export function evaluateComplianceStrategicAdaptationReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicAdaptationReadiness ?? []
  const refinement = input.complianceStrategicRefinementBacklog ?? {}
  const effectiveness = input.complianceStrategicCommunicationEffectiveness ?? {}
  const strategy = input.complianceExecutiveStrategyPlan ?? {}
  const refinementScore = refinement.strategicRefinementSummary?.averageRefinementScore ?? 0
  const effectivenessScore = effectiveness.communicationEffectivenessSummary?.averageEffectivenessScore ?? refinementScore
  const strategyScore = strategy.executiveStrategySummary?.averageStrategyScore ?? refinementScore
  const score = Math.max(0, Math.min(100, Math.round((refinementScore + effectivenessScore + strategyScore) / 3)))
  const adaptationStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const adaptations = (supplied.length ? supplied : [normalizeComplianceStrategicAdaptationReadiness({
    tenantContext,
    adaptationStatus,
    adaptationScore: score,
    adaptationSummaryText: `Compliance strategic adaptation readiness references refinement score ${refinementScore}, effectiveness score ${effectivenessScore}, and strategy score ${strategyScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-refinement-backlog', type: 'compliance-strategic-refinement-backlog', eventType: refinement.eventType },
      { id: 'compliance-strategic-communication-effectiveness', type: 'compliance-strategic-communication-effectiveness', eventType: effectiveness.eventType },
      { id: 'compliance-executive-strategy-plan', type: 'compliance-executive-strategy-plan', eventType: strategy.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicAdaptationReadiness)
  const strategicAdaptationSummary = {
    total: adaptations.length,
    ready: adaptations.filter((item) => item.adaptationStatus === 'ready').length,
    caution: adaptations.filter((item) => item.adaptationStatus === 'caution').length,
    blocked: adaptations.filter((item) => item.adaptationStatus === 'blocked').length,
    averageAdaptationScore: adaptations.length ? Math.round(adaptations.reduce((sum, item) => sum + item.adaptationScore, 0) / adaptations.length) : 0,
  }
  const strategicAdaptationStatus = strategicAdaptationSummary.blocked > 0 ? 'blocked' : strategicAdaptationSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_ADAPTATION_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicAdaptationReadiness: adaptations,
    strategicAdaptationSummary,
    strategicAdaptationStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAdaptation: false,
    automaticStrategyChange: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic adaptation readiness ${strategicAdaptationStatus}: average adaptation score ${strategicAdaptationSummary.averageAdaptationScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_ADAPTATION_READINESS_EVALUATED_EVENT, result)
  return result
}
