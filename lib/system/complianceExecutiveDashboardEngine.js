import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_EXECUTIVE_DASHBOARD_EVALUATED_EVENT = 'system.complianceExecutiveDashboard.evaluated'

export const EXECUTIVE_DASHBOARD_STATUSES = Object.freeze(['healthy', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceExecutiveDashboard(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-executive-dashboard-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    dashboardStatus: EXECUTIVE_DASHBOARD_STATUSES.includes(input.dashboardStatus ?? input.status) ? (input.dashboardStatus ?? input.status) : 'caution',
    dashboardScore: Math.max(0, Math.min(100, Number(input.dashboardScore ?? 0))),
    dashboardSummary: String(input.dashboardSummary ?? 'Compliance executive dashboard evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticDistribution: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceExecutiveDashboardRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(dashboardInput) {
      const dashboard = normalizeComplianceExecutiveDashboard(dashboardInput)
      if (!database?.connected) return { ok: true, disabled: true, dashboard }
      const result = await database.query(
        `INSERT INTO atlas_compliance_executive_dashboards
          (id, organization_id, team_workspace_id, dashboard_status, dashboard_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET dashboard_status = EXCLUDED.dashboard_status, dashboard_score = EXCLUDED.dashboard_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [dashboard.id, dashboard.tenantScope.organizationId, dashboard.tenantScope.teamWorkspaceId, dashboard.dashboardStatus, dashboard.dashboardScore, dashboard],
      )
      return { ok: true, dashboard: normalizeComplianceExecutiveDashboard(result.rows?.[0]?.payload ?? dashboard) }
    },
    async list({ tenantContext = {}, dashboardStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (dashboardStatus) {
        params.push(EXECUTIVE_DASHBOARD_STATUSES.includes(dashboardStatus) ? dashboardStatus : 'caution')
        clauses.push(`dashboard_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_executive_dashboards
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceExecutiveDashboard(row.payload))
    },
  }
}

export function evaluateComplianceExecutiveDashboard(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceExecutiveDashboards ?? []
  const metrics = input.complianceMetricsSnapshot ?? {}
  const executiveSummary = input.complianceExecutiveSummary ?? {}
  const programHealth = input.complianceProgramHealth ?? {}
  const risk = input.complianceRiskCommandCenter ?? {}
  const score = Math.max(0, Math.min(100, (metrics.metricsSnapshotSummary?.averageHealthScore ?? 0)
    - (executiveSummary.executiveSummaryStatus === 'caution' ? 10 : 0)
    - (risk.commandCenterStatus === 'blocked' ? 20 : risk.commandCenterStatus === 'caution' ? 8 : 0)))
  const dashboardStatus = score < 60 || programHealth.programHealthStatus === 'blocked' ? 'blocked' : score < 85 || metrics.metricsSnapshotStatus === 'caution' ? 'caution' : 'healthy'
  const dashboards = (supplied.length ? supplied : [normalizeComplianceExecutiveDashboard({
    tenantContext,
    dashboardStatus,
    dashboardScore: score,
    dashboardSummary: `Compliance executive dashboard summarizes metrics snapshot, executive summary, program health, and risk command center with a ${score} dashboard score.`,
    sourceReferences: [
      { id: 'compliance-metrics-snapshot', type: 'compliance-metrics-snapshot', eventType: metrics.eventType },
      { id: 'compliance-executive-summary', type: 'compliance-executive-summary', eventType: executiveSummary.eventType },
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: programHealth.eventType },
      { id: 'compliance-risk-command', type: 'compliance-risk-command-center', eventType: risk.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceExecutiveDashboard)
  const executiveDashboardSummary = {
    total: dashboards.length,
    healthy: dashboards.filter((item) => item.dashboardStatus === 'healthy').length,
    caution: dashboards.filter((item) => item.dashboardStatus === 'caution').length,
    blocked: dashboards.filter((item) => item.dashboardStatus === 'blocked').length,
    averageScore: dashboards.length ? Math.round(dashboards.reduce((sum, item) => sum + item.dashboardScore, 0) / dashboards.length) : 0,
  }
  const executiveDashboardStatus = executiveDashboardSummary.blocked > 0 ? 'blocked' : executiveDashboardSummary.caution > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_EXECUTIVE_DASHBOARD_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceExecutiveDashboards: dashboards,
    executiveDashboardSummary,
    executiveDashboardStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticDistribution: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance executive dashboard ${executiveDashboardStatus}: average score ${executiveDashboardSummary.averageScore} across ${executiveDashboardSummary.total} dashboard evaluations.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_EXECUTIVE_DASHBOARD_EVALUATED_EVENT, result)
  return result
}
