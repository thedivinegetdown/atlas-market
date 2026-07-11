import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_SCENARIO_PLANNING_EVALUATED_EVENT = 'system.complianceScenarioPlanning.evaluated'

export const SCENARIO_STATUSES = Object.freeze(['resilient', 'watchlist', 'strained'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return SCENARIO_STATUSES.includes(status) ? status : 'watchlist'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceScenarioPlan(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-scenario-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    scenarioStatus: safeStatus(input.scenarioStatus ?? input.status),
    scenarioScore: Math.max(0, Math.min(100, Number(input.scenarioScore ?? 0))),
    scenarioName: String(input.scenarioName ?? 'Compliance planning scenario').slice(0, 160),
    scenarioSummary: String(input.scenarioSummary ?? 'Compliance scenario plan evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceScenarioPlanningRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const scenario = normalizeComplianceScenarioPlan(input)
      if (!database?.connected) return { ok: true, disabled: true, scenario }
      const result = await database.query(
        `INSERT INTO atlas_compliance_scenario_plans
          (id, organization_id, team_workspace_id, scenario_status, scenario_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET scenario_status = EXCLUDED.scenario_status, scenario_score = EXCLUDED.scenario_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [scenario.id, scenario.tenantScope.organizationId, scenario.tenantScope.teamWorkspaceId, scenario.scenarioStatus, scenario.scenarioScore, scenario],
      )
      return { ok: true, scenario: normalizeComplianceScenarioPlan(result.rows?.[0]?.payload ?? scenario) }
    },
    async list({ tenantContext = {}, scenarioStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (scenarioStatus) {
        params.push(safeStatus(scenarioStatus))
        clauses.push(`scenario_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_scenario_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceScenarioPlan(row.payload))
    },
  }
}

export function evaluateComplianceScenarioPlanning(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceScenarioPlans ?? []
  const forecast = input.complianceRiskForecast ?? {}
  const benchmark = input.complianceBenchmarkComparison ?? {}
  const forecastScore = forecast.forecastSummary?.averageForecastScore ?? 0
  const benchmarkScore = benchmark.benchmarkSummary?.averageBenchmarkScore ?? 0
  const scenarioScore = Math.max(0, Math.min(100, Math.round(benchmarkScore - Math.max(0, forecastScore - 35))))
  const scenarioStatus = scenarioScore >= 85 ? 'resilient' : scenarioScore >= 65 ? 'watchlist' : 'strained'
  const scenarios = (supplied.length ? supplied : [normalizeComplianceScenarioPlan({
    tenantContext,
    scenarioStatus,
    scenarioScore,
    scenarioName: 'Compliance risk pressure scenario',
    scenarioSummary: `Compliance scenario planning combines benchmark score ${benchmarkScore} with forecast score ${forecastScore} for advisory operator planning.`,
    sourceReferences: [
      { id: 'compliance-risk-forecast', type: 'compliance-risk-forecast', eventType: forecast.eventType },
      { id: 'compliance-benchmark-comparison', type: 'compliance-benchmark-comparison', eventType: benchmark.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceScenarioPlan)
  const scenarioSummary = {
    total: scenarios.length,
    resilient: scenarios.filter((item) => item.scenarioStatus === 'resilient').length,
    watchlist: scenarios.filter((item) => item.scenarioStatus === 'watchlist').length,
    strained: scenarios.filter((item) => item.scenarioStatus === 'strained').length,
    averageScenarioScore: scenarios.length ? Math.round(scenarios.reduce((sum, item) => sum + item.scenarioScore, 0) / scenarios.length) : 0,
  }
  const scenarioPlanningStatus = scenarioSummary.strained > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_SCENARIO_PLANNING_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceScenarioPlans: scenarios,
    scenarioSummary,
    scenarioPlanningStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance scenario planning ${scenarioPlanningStatus}: ${scenarioSummary.resilient} resilient, ${scenarioSummary.watchlist} watchlist, and ${scenarioSummary.strained} strained scenarios.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_SCENARIO_PLANNING_EVALUATED_EVENT, result)
  return result
}
