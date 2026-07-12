import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_ADOPTION_READINESS_EVALUATED_EVENT = 'system.complianceAdoptionReadiness.evaluated'
export const ADOPTION_READINESS_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return ADOPTION_READINESS_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceAdoptionReadiness(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-adoption-readiness-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    adoptionStatus: safeStatus(input.adoptionStatus ?? input.status),
    adoptionScore: Math.max(0, Math.min(100, Number(input.adoptionScore ?? 0))),
    adoptionSummaryText: String(input.adoptionSummaryText ?? input.adoptionSummary ?? 'Compliance adoption readiness evaluated for human review.').slice(0, 700),
    adoptionBlockerSummary: String(input.adoptionBlockerSummary ?? 'No automatic adoption actions are executed.').slice(0, 500),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAdoption: false,
    automaticRemediation: false,
    automaticPolicyUpdate: false,
    automaticTrainingAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceAdoptionReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const readiness = normalizeComplianceAdoptionReadiness(input)
      if (!database?.connected) return { ok: true, disabled: true, readiness }
      const result = await database.query(
        `INSERT INTO atlas_compliance_adoption_readiness
          (id, organization_id, team_workspace_id, adoption_status, adoption_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET adoption_status = EXCLUDED.adoption_status, adoption_score = EXCLUDED.adoption_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [readiness.id, readiness.tenantScope.organizationId, readiness.tenantScope.teamWorkspaceId, readiness.adoptionStatus, readiness.adoptionScore, readiness],
      )
      return { ok: true, readiness: normalizeComplianceAdoptionReadiness(result.rows?.[0]?.payload ?? readiness) }
    },
    async list({ tenantContext = {}, adoptionStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (adoptionStatus) {
        params.push(safeStatus(adoptionStatus))
        clauses.push(`adoption_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_adoption_readiness
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceAdoptionReadiness(row.payload))
    },
  }
}

export function evaluateComplianceAdoptionReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceAdoptionReadiness ?? []
  const opportunities = input.complianceImprovementOpportunity ?? {}
  const resourcePlanning = input.complianceResourcePlanning ?? {}
  const training = input.complianceTrainingReadiness ?? {}
  const opportunityScore = opportunities.opportunitySummary?.averageOpportunityScore ?? 0
  const resourceScore = resourcePlanning.resourceSummary?.averageResourceScore ?? opportunityScore
  const trainingScore = training.trainingSummary?.averageTrainingScore ?? opportunityScore
  const score = Math.max(0, Math.min(100, Math.round((opportunityScore + resourceScore + trainingScore) / 3)))
  const adoptionStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const readinessItems = (supplied.length ? supplied : [normalizeComplianceAdoptionReadiness({
    tenantContext,
    adoptionStatus,
    adoptionScore: score,
    adoptionSummaryText: `Compliance adoption readiness references opportunity score ${opportunityScore}, resource score ${resourceScore}, and training score ${trainingScore}.`,
    adoptionBlockerSummary: adoptionStatus === 'blocked' ? 'Human review is required before any adoption planning can proceed.' : 'No automatic adoption actions are executed.',
    sourceReferences: [
      { id: 'compliance-improvement-opportunities', type: 'compliance-improvement-opportunities', eventType: opportunities.eventType },
      { id: 'compliance-resource-planning', type: 'compliance-resource-planning', eventType: resourcePlanning.eventType },
      { id: 'compliance-training-readiness', type: 'compliance-training-readiness', eventType: training.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceAdoptionReadiness)
  const adoptionSummary = {
    total: readinessItems.length,
    ready: readinessItems.filter((item) => item.adoptionStatus === 'ready').length,
    caution: readinessItems.filter((item) => item.adoptionStatus === 'caution').length,
    blocked: readinessItems.filter((item) => item.adoptionStatus === 'blocked').length,
    averageAdoptionScore: readinessItems.length ? Math.round(readinessItems.reduce((sum, item) => sum + item.adoptionScore, 0) / readinessItems.length) : 0,
  }
  const adoptionReadinessStatus = adoptionSummary.blocked > 0 ? 'blocked' : adoptionSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_ADOPTION_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceAdoptionReadiness: readinessItems,
    adoptionSummary,
    adoptionReadinessStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAdoption: false,
    automaticRemediation: false,
    automaticPolicyUpdate: false,
    automaticTrainingAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance adoption readiness ${adoptionReadinessStatus}: average adoption score ${adoptionSummary.averageAdoptionScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_ADOPTION_READINESS_EVALUATED_EVENT, result)
  return result
}
