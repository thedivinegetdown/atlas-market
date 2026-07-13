import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_EFFECTIVENESS_REVIEWED_EVENT = 'system.complianceStrategicCommunicationEffectiveness.reviewed'
export const COMMUNICATION_EFFECTIVENESS_STATUSES = Object.freeze(['effective', 'needs-review', 'ineffective'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return COMMUNICATION_EFFECTIVENESS_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicCommunicationEffectiveness(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-communication-effectiveness-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    effectivenessStatus: safeStatus(input.effectivenessStatus ?? input.status),
    effectivenessScore: Math.max(0, Math.min(100, Number(input.effectivenessScore ?? 0))),
    effectivenessSummaryText: String(input.effectivenessSummaryText ?? input.effectivenessSummary ?? 'Compliance strategic communication effectiveness reviewed for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticEffectivenessClaim: false,
    automaticRemediation: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicCommunicationEffectivenessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const effectiveness = normalizeComplianceStrategicCommunicationEffectiveness(input)
      if (!database?.connected) return { ok: true, disabled: true, effectiveness }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_communication_effectiveness
          (id, organization_id, team_workspace_id, effectiveness_status, effectiveness_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET effectiveness_status = EXCLUDED.effectiveness_status, effectiveness_score = EXCLUDED.effectiveness_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [effectiveness.id, effectiveness.tenantScope.organizationId, effectiveness.tenantScope.teamWorkspaceId, effectiveness.effectivenessStatus, effectiveness.effectivenessScore, effectiveness],
      )
      return { ok: true, effectiveness: normalizeComplianceStrategicCommunicationEffectiveness(result.rows?.[0]?.payload ?? effectiveness) }
    },
    async list({ tenantContext = {}, effectivenessStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (effectivenessStatus) {
        params.push(safeStatus(effectivenessStatus))
        clauses.push(`effectiveness_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_communication_effectiveness
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicCommunicationEffectiveness(row.payload))
    },
  }
}

export function reviewComplianceStrategicCommunicationEffectiveness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicCommunicationEffectiveness ?? []
  const feedback = input.complianceStrategicFeedbackIntake ?? {}
  const communication = input.complianceStrategicCommunicationPlan ?? {}
  const kpis = input.complianceStrategicKpis ?? {}
  const feedbackScore = feedback.strategicFeedbackSummary?.averageFeedbackScore ?? 0
  const communicationScore = communication.strategicCommunicationSummary?.averageCommunicationScore ?? feedbackScore
  const kpiScore = kpis.strategicKpiSummary?.averageKpiScore ?? feedbackScore
  const score = Math.max(0, Math.min(100, Math.round((feedbackScore + communicationScore + kpiScore) / 3)))
  const effectivenessStatus = score >= 85 ? 'effective' : score >= 60 ? 'needs-review' : 'ineffective'
  const effectivenessItems = (supplied.length ? supplied : [normalizeComplianceStrategicCommunicationEffectiveness({
    tenantContext,
    effectivenessStatus,
    effectivenessScore: score,
    effectivenessSummaryText: `Compliance strategic communication effectiveness references feedback score ${feedbackScore}, communication score ${communicationScore}, and KPI score ${kpiScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-feedback-intake', type: 'compliance-strategic-feedback-intake', eventType: feedback.eventType },
      { id: 'compliance-strategic-communication-plan', type: 'compliance-strategic-communication-plan', eventType: communication.eventType },
      { id: 'compliance-strategic-kpis', type: 'compliance-strategic-kpis', eventType: kpis.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicCommunicationEffectiveness)
  const communicationEffectivenessSummary = {
    total: effectivenessItems.length,
    effective: effectivenessItems.filter((item) => item.effectivenessStatus === 'effective').length,
    needsReview: effectivenessItems.filter((item) => item.effectivenessStatus === 'needs-review').length,
    ineffective: effectivenessItems.filter((item) => item.effectivenessStatus === 'ineffective').length,
    averageEffectivenessScore: effectivenessItems.length ? Math.round(effectivenessItems.reduce((sum, item) => sum + item.effectivenessScore, 0) / effectivenessItems.length) : 0,
  }
  const communicationEffectivenessStatus = communicationEffectivenessSummary.ineffective > 0 ? 'blocked' : communicationEffectivenessSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_EFFECTIVENESS_REVIEWED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicCommunicationEffectiveness: effectivenessItems,
    communicationEffectivenessSummary,
    communicationEffectivenessStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticEffectivenessClaim: false,
    automaticRemediation: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic communication effectiveness ${communicationEffectivenessStatus}: average effectiveness score ${communicationEffectivenessSummary.averageEffectivenessScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_EFFECTIVENESS_REVIEWED_EVENT, result)
  return result
}
