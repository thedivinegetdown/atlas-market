import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_EXECUTIVE_STRATEGY_PLAN_PREPARED_EVENT = 'system.complianceExecutiveStrategyPlan.prepared'
export const EXECUTIVE_STRATEGY_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return EXECUTIVE_STRATEGY_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceExecutiveStrategyPlan(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-executive-strategy-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    strategyStatus: safeStatus(input.strategyStatus ?? input.status),
    strategyScore: Math.max(0, Math.min(100, Number(input.strategyScore ?? 0))),
    strategySummaryText: String(input.strategySummaryText ?? input.strategySummary ?? 'Compliance executive strategy plan prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticExecutiveApproval: false,
    automaticDistribution: false,
    automaticFundingAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceExecutiveStrategyPlanRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const strategy = normalizeComplianceExecutiveStrategyPlan(input)
      if (!database?.connected) return { ok: true, disabled: true, strategy }
      const result = await database.query(
        `INSERT INTO atlas_compliance_executive_strategy_plans
          (id, organization_id, team_workspace_id, strategy_status, strategy_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET strategy_status = EXCLUDED.strategy_status, strategy_score = EXCLUDED.strategy_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [strategy.id, strategy.tenantScope.organizationId, strategy.tenantScope.teamWorkspaceId, strategy.strategyStatus, strategy.strategyScore, strategy],
      )
      return { ok: true, strategy: normalizeComplianceExecutiveStrategyPlan(result.rows?.[0]?.payload ?? strategy) }
    },
    async list({ tenantContext = {}, strategyStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (strategyStatus) {
        params.push(safeStatus(strategyStatus))
        clauses.push(`strategy_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_executive_strategy_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceExecutiveStrategyPlan(row.payload))
    },
  }
}

export function prepareComplianceExecutiveStrategyPlan(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceExecutiveStrategyPlans ?? []
  const initiatives = input.complianceStrategicInitiativePortfolio ?? {}
  const executive = input.complianceExecutiveDashboard ?? {}
  const governance = input.complianceGovernanceReadout ?? {}
  const initiativeScore = initiatives.initiativePortfolioSummary?.averageInitiativeScore ?? 0
  const dashboardScore = executive.executiveDashboardSummary?.averageDashboardScore ?? initiativeScore
  const readoutScore = governance.readoutSummary?.averageReadoutScore ?? initiativeScore
  const score = Math.max(0, Math.min(100, Math.round((initiativeScore + dashboardScore + readoutScore) / 3)))
  const strategyStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const strategies = (supplied.length ? supplied : [normalizeComplianceExecutiveStrategyPlan({
    tenantContext,
    strategyStatus,
    strategyScore: score,
    strategySummaryText: `Compliance executive strategy plan references initiative score ${initiativeScore}, dashboard score ${dashboardScore}, and governance readout score ${readoutScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-initiative-portfolio', type: 'compliance-strategic-initiative-portfolio', eventType: initiatives.eventType },
      { id: 'compliance-executive-dashboard', type: 'compliance-executive-dashboard', eventType: executive.eventType },
      { id: 'compliance-governance-readout', type: 'compliance-governance-readout', eventType: governance.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceExecutiveStrategyPlan)
  const executiveStrategySummary = {
    total: strategies.length,
    ready: strategies.filter((item) => item.strategyStatus === 'ready').length,
    caution: strategies.filter((item) => item.strategyStatus === 'caution').length,
    blocked: strategies.filter((item) => item.strategyStatus === 'blocked').length,
    averageStrategyScore: strategies.length ? Math.round(strategies.reduce((sum, item) => sum + item.strategyScore, 0) / strategies.length) : 0,
  }
  const executiveStrategyStatus = executiveStrategySummary.blocked > 0 ? 'blocked' : executiveStrategySummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_EXECUTIVE_STRATEGY_PLAN_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceExecutiveStrategyPlans: strategies,
    executiveStrategySummary,
    executiveStrategyStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticExecutiveApproval: false,
    automaticDistribution: false,
    automaticFundingAction: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance executive strategy plan ${executiveStrategyStatus}: average strategy score ${executiveStrategySummary.averageStrategyScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_EXECUTIVE_STRATEGY_PLAN_PREPARED_EVENT, result)
  return result
}
