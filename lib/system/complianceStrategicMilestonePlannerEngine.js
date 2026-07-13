import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_MILESTONES_PLANNED_EVENT = 'system.complianceStrategicMilestones.planned'
export const STRATEGIC_MILESTONE_STATUSES = Object.freeze(['on-track', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_MILESTONE_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicMilestonePlan(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-milestone-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    milestoneStatus: safeStatus(input.milestoneStatus ?? input.status),
    milestoneScore: Math.max(0, Math.min(100, Number(input.milestoneScore ?? 0))),
    milestoneSummaryText: String(input.milestoneSummaryText ?? input.milestoneSummary ?? 'Compliance strategic milestones planned for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticMilestoneApproval: false,
    automaticAssignment: false,
    automaticFundingAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicMilestonePlanRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const milestone = normalizeComplianceStrategicMilestonePlan(input)
      if (!database?.connected) return { ok: true, disabled: true, milestone }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_milestone_plans
          (id, organization_id, team_workspace_id, milestone_status, milestone_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET milestone_status = EXCLUDED.milestone_status, milestone_score = EXCLUDED.milestone_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [milestone.id, milestone.tenantScope.organizationId, milestone.tenantScope.teamWorkspaceId, milestone.milestoneStatus, milestone.milestoneScore, milestone],
      )
      return { ok: true, milestone: normalizeComplianceStrategicMilestonePlan(result.rows?.[0]?.payload ?? milestone) }
    },
    async list({ tenantContext = {}, milestoneStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (milestoneStatus) {
        params.push(safeStatus(milestoneStatus))
        clauses.push(`milestone_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_milestone_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicMilestonePlan(row.payload))
    },
  }
}

export function planComplianceStrategicMilestones(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicMilestonePlans ?? []
  const strategy = input.complianceExecutiveStrategyPlan ?? {}
  const implementation = input.complianceImplementationPlanning ?? {}
  const actions = input.complianceGovernanceActionItems ?? {}
  const strategyScore = strategy.executiveStrategySummary?.averageStrategyScore ?? 0
  const implementationScore = implementation.implementationSummary?.averageImplementationScore ?? strategyScore
  const actionPenalty = Math.min(25, Number(actions.actionItemSummary?.highPriority ?? 0) * 5)
  const score = Math.max(0, Math.min(100, Math.round(((strategyScore + implementationScore) / 2) - actionPenalty)))
  const milestoneStatus = score >= 85 ? 'on-track' : score >= 60 ? 'needs-review' : 'blocked'
  const milestones = (supplied.length ? supplied : [normalizeComplianceStrategicMilestonePlan({
    tenantContext,
    milestoneStatus,
    milestoneScore: score,
    milestoneSummaryText: `Compliance strategic milestones reference strategy score ${strategyScore}, implementation score ${implementationScore}, and high-priority action penalty ${actionPenalty}.`,
    sourceReferences: [
      { id: 'compliance-executive-strategy-plan', type: 'compliance-executive-strategy-plan', eventType: strategy.eventType },
      { id: 'compliance-implementation-planning', type: 'compliance-implementation-planning', eventType: implementation.eventType },
      { id: 'compliance-governance-action-items', type: 'compliance-governance-action-items', eventType: actions.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicMilestonePlan)
  const strategicMilestoneSummary = {
    total: milestones.length,
    onTrack: milestones.filter((item) => item.milestoneStatus === 'on-track').length,
    needsReview: milestones.filter((item) => item.milestoneStatus === 'needs-review').length,
    blocked: milestones.filter((item) => item.milestoneStatus === 'blocked').length,
    averageMilestoneScore: milestones.length ? Math.round(milestones.reduce((sum, item) => sum + item.milestoneScore, 0) / milestones.length) : 0,
  }
  const strategicMilestoneStatus = strategicMilestoneSummary.blocked > 0 ? 'blocked' : strategicMilestoneSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_MILESTONES_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicMilestonePlans: milestones,
    strategicMilestoneSummary,
    strategicMilestoneStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticMilestoneApproval: false,
    automaticAssignment: false,
    automaticFundingAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic milestones ${strategicMilestoneStatus}: average milestone score ${strategicMilestoneSummary.averageMilestoneScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_MILESTONES_PLANNED_EVENT, result)
  return result
}
