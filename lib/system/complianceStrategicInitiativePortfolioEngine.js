import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_INITIATIVE_PORTFOLIO_EVALUATED_EVENT = 'system.complianceStrategicInitiativePortfolio.evaluated'
export const STRATEGIC_INITIATIVE_STATUSES = Object.freeze(['aligned', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_INITIATIVE_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicInitiativePortfolio(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-initiative-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    initiativeStatus: safeStatus(input.initiativeStatus ?? input.status),
    initiativeScore: Math.max(0, Math.min(100, Number(input.initiativeScore ?? 0))),
    initiativeSummaryText: String(input.initiativeSummaryText ?? input.initiativeSummary ?? 'Compliance strategic initiative portfolio evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    recommendationOnly: true,
    automaticInitiativeApproval: false,
    automaticFundingAction: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicInitiativePortfolioRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const initiative = normalizeComplianceStrategicInitiativePortfolio(input)
      if (!database?.connected) return { ok: true, disabled: true, initiative }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_initiative_portfolios
          (id, organization_id, team_workspace_id, initiative_status, initiative_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET initiative_status = EXCLUDED.initiative_status, initiative_score = EXCLUDED.initiative_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [initiative.id, initiative.tenantScope.organizationId, initiative.tenantScope.teamWorkspaceId, initiative.initiativeStatus, initiative.initiativeScore, initiative],
      )
      return { ok: true, initiative: normalizeComplianceStrategicInitiativePortfolio(result.rows?.[0]?.payload ?? initiative) }
    },
    async list({ tenantContext = {}, initiativeStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (initiativeStatus) {
        params.push(safeStatus(initiativeStatus))
        clauses.push(`initiative_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_initiative_portfolios
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicInitiativePortfolio(row.payload))
    },
  }
}

export function evaluateComplianceStrategicInitiativePortfolio(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicInitiativePortfolios ?? []
  const roadmap = input.complianceOptimizationRoadmap ?? {}
  const continuous = input.complianceContinuousImprovementProgram ?? {}
  const resource = input.complianceResourcePlanning ?? {}
  const roadmapScore = roadmap.optimizationRoadmapSummary?.averageRoadmapScore ?? 0
  const programScore = continuous.continuousImprovementSummary?.averageProgramScore ?? roadmapScore
  const resourceScore = resource.resourceSummary?.averageResourceScore ?? roadmapScore
  const score = Math.max(0, Math.min(100, Math.round((roadmapScore + programScore + resourceScore) / 3)))
  const initiativeStatus = score >= 85 ? 'aligned' : score >= 60 ? 'needs-review' : 'blocked'
  const initiatives = (supplied.length ? supplied : [normalizeComplianceStrategicInitiativePortfolio({
    tenantContext,
    initiativeStatus,
    initiativeScore: score,
    initiativeSummaryText: `Compliance strategic initiative portfolio references roadmap score ${roadmapScore}, program score ${programScore}, and resource score ${resourceScore}.`,
    sourceReferences: [
      { id: 'compliance-optimization-roadmap', type: 'compliance-optimization-roadmap', eventType: roadmap.eventType },
      { id: 'compliance-continuous-improvement-program', type: 'compliance-continuous-improvement-program', eventType: continuous.eventType },
      { id: 'compliance-resource-planning', type: 'compliance-resource-planning', eventType: resource.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicInitiativePortfolio)
  const initiativePortfolioSummary = {
    total: initiatives.length,
    aligned: initiatives.filter((item) => item.initiativeStatus === 'aligned').length,
    needsReview: initiatives.filter((item) => item.initiativeStatus === 'needs-review').length,
    blocked: initiatives.filter((item) => item.initiativeStatus === 'blocked').length,
    averageInitiativeScore: initiatives.length ? Math.round(initiatives.reduce((sum, item) => sum + item.initiativeScore, 0) / initiatives.length) : 0,
  }
  const strategicInitiativeStatus = initiativePortfolioSummary.blocked > 0 ? 'blocked' : initiativePortfolioSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_INITIATIVE_PORTFOLIO_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicInitiativePortfolios: initiatives,
    initiativePortfolioSummary,
    strategicInitiativeStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    recommendationOnly: true,
    automaticInitiativeApproval: false,
    automaticFundingAction: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic initiative portfolio ${strategicInitiativeStatus}: average initiative score ${initiativePortfolioSummary.averageInitiativeScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_INITIATIVE_PORTFOLIO_EVALUATED_EVENT, result)
  return result
}
