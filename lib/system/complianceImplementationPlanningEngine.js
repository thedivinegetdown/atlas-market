import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_IMPLEMENTATION_PLAN_PREPARED_EVENT = 'system.complianceImplementationPlan.prepared'

export const IMPLEMENTATION_STATUSES = Object.freeze(['ready', 'planning', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return IMPLEMENTATION_STATUSES.includes(status) ? status : 'planning'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceImplementationPlan(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-implementation-plan-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    implementationStatus: safeStatus(input.implementationStatus ?? input.status),
    implementationScore: Math.max(0, Math.min(100, Number(input.implementationScore ?? 0))),
    implementationSummaryText: String(input.implementationSummaryText ?? input.implementationSummary ?? 'Compliance implementation plan prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticImplementation: false,
    automaticPolicyUpdate: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceImplementationPlanningRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const plan = normalizeComplianceImplementationPlan(input)
      if (!database?.connected) return { ok: true, disabled: true, plan }
      const result = await database.query(
        `INSERT INTO atlas_compliance_implementation_plans
          (id, organization_id, team_workspace_id, implementation_status, implementation_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET implementation_status = EXCLUDED.implementation_status, implementation_score = EXCLUDED.implementation_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [plan.id, plan.tenantScope.organizationId, plan.tenantScope.teamWorkspaceId, plan.implementationStatus, plan.implementationScore, plan],
      )
      return { ok: true, plan: normalizeComplianceImplementationPlan(result.rows?.[0]?.payload ?? plan) }
    },
    async list({ tenantContext = {}, implementationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (implementationStatus) {
        params.push(safeStatus(implementationStatus))
        clauses.push(`implementation_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_implementation_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceImplementationPlan(row.payload))
    },
  }
}

export function prepareComplianceImplementationPlan(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceImplementationPlans ?? []
  const impact = input.complianceChangeImpactAssessment ?? {}
  const resource = input.complianceResourcePlanning ?? {}
  const continuity = input.complianceContinuityReadiness ?? {}
  const resourceScore = resource.resourceSummary?.averageResourceScore ?? 0
  const continuityScore = continuity.continuitySummary?.averageContinuityScore ?? 0
  const impactPressure = impact.impactSummary?.averageImpactScore ?? 0
  const score = Math.max(0, Math.min(100, Math.round((resourceScore + continuityScore) / 2) - Math.max(0, impactPressure - 50)))
  const implementationStatus = score >= 80 ? 'ready' : score >= 55 ? 'planning' : 'blocked'
  const plans = (supplied.length ? supplied : [normalizeComplianceImplementationPlan({
    tenantContext,
    implementationStatus,
    implementationScore: score,
    implementationSummaryText: `Compliance implementation plan uses resource score ${resourceScore}, continuity score ${continuityScore}, and change impact pressure ${impactPressure}.`,
    sourceReferences: [
      { id: 'compliance-change-impact-assessment', type: 'compliance-change-impact-assessment', eventType: impact.eventType },
      { id: 'compliance-resource-planning', type: 'compliance-resource-planning', eventType: resource.eventType },
      { id: 'compliance-continuity-readiness', type: 'compliance-continuity-readiness', eventType: continuity.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceImplementationPlan)
  const implementationSummary = {
    total: plans.length,
    ready: plans.filter((item) => item.implementationStatus === 'ready').length,
    planning: plans.filter((item) => item.implementationStatus === 'planning').length,
    blocked: plans.filter((item) => item.implementationStatus === 'blocked').length,
    averageImplementationScore: plans.length ? Math.round(plans.reduce((sum, item) => sum + item.implementationScore, 0) / plans.length) : 0,
  }
  const implementationPlanningStatus = implementationSummary.blocked > 0 ? 'blocked' : implementationSummary.planning > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_IMPLEMENTATION_PLAN_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceImplementationPlans: plans,
    implementationSummary,
    implementationPlanningStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticImplementation: false,
    automaticPolicyUpdate: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance implementation planning ${implementationPlanningStatus}: average implementation score ${implementationSummary.averageImplementationScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_IMPLEMENTATION_PLAN_PREPARED_EVENT, result)
  return result
}
