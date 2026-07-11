import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_RESOURCE_PLANNING_EVALUATED_EVENT = 'system.complianceResourcePlanning.evaluated'

export const RESOURCE_STATUSES = Object.freeze(['sufficient', 'monitor', 'constrained'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return RESOURCE_STATUSES.includes(status) ? status : 'monitor'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceResourcePlan(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-resource-plan-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    resourceStatus: safeStatus(input.resourceStatus ?? input.status),
    resourceScore: Math.max(0, Math.min(100, Number(input.resourceScore ?? 0))),
    recommendedFocus: String(input.recommendedFocus ?? 'Maintain compliance operating capacity.').slice(0, 240),
    resourceSummary: String(input.resourceSummary ?? 'Compliance resource plan evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAssignment: false,
    automaticBudgetAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceResourcePlanningRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const plan = normalizeComplianceResourcePlan(input)
      if (!database?.connected) return { ok: true, disabled: true, plan }
      const result = await database.query(
        `INSERT INTO atlas_compliance_resource_plans
          (id, organization_id, team_workspace_id, resource_status, resource_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET resource_status = EXCLUDED.resource_status, resource_score = EXCLUDED.resource_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [plan.id, plan.tenantScope.organizationId, plan.tenantScope.teamWorkspaceId, plan.resourceStatus, plan.resourceScore, plan],
      )
      return { ok: true, plan: normalizeComplianceResourcePlan(result.rows?.[0]?.payload ?? plan) }
    },
    async list({ tenantContext = {}, resourceStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (resourceStatus) {
        params.push(safeStatus(resourceStatus))
        clauses.push(`resource_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_resource_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceResourcePlan(row.payload))
    },
  }
}

export function evaluateComplianceResourcePlanning(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceResourcePlans ?? []
  const scenario = input.complianceScenarioPlanning ?? {}
  const actionItems = input.complianceGovernanceActionItems ?? {}
  const scenarioScore = scenario.scenarioSummary?.averageScenarioScore ?? 0
  const highPriorityItems = actionItems.actionItemSummary?.highPriority ?? 0
  const score = Math.max(0, Math.min(100, scenarioScore - highPriorityItems * 8))
  const resourceStatus = score >= 85 ? 'sufficient' : score >= 65 ? 'monitor' : 'constrained'
  const plans = (supplied.length ? supplied : [normalizeComplianceResourcePlan({
    tenantContext,
    resourceStatus,
    resourceScore: score,
    recommendedFocus: resourceStatus === 'constrained' ? 'Review compliance workload coverage and escalation capacity.' : 'Maintain compliance review cadence and action item follow-through.',
    resourceSummary: `Compliance resource planning combines scenario score ${scenarioScore} with ${highPriorityItems} high priority governance action items.`,
    sourceReferences: [
      { id: 'compliance-scenario-planning', type: 'compliance-scenario-planning', eventType: scenario.eventType },
      { id: 'compliance-governance-action-items', type: 'compliance-governance-action-items', eventType: actionItems.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceResourcePlan)
  const resourceSummary = {
    total: plans.length,
    sufficient: plans.filter((item) => item.resourceStatus === 'sufficient').length,
    monitor: plans.filter((item) => item.resourceStatus === 'monitor').length,
    constrained: plans.filter((item) => item.resourceStatus === 'constrained').length,
    averageResourceScore: plans.length ? Math.round(plans.reduce((sum, item) => sum + item.resourceScore, 0) / plans.length) : 0,
  }
  const resourcePlanningStatus = resourceSummary.constrained > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_RESOURCE_PLANNING_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceResourcePlans: plans,
    resourceSummary,
    resourcePlanningStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticAssignment: false,
    automaticBudgetAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance resource planning ${resourcePlanningStatus}: average resource score ${resourceSummary.averageResourceScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_RESOURCE_PLANNING_EVALUATED_EVENT, result)
  return result
}
