import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_RISK_FORECAST_EVALUATED_EVENT = 'system.complianceRiskForecast.evaluated'

export const FORECAST_STATUSES = Object.freeze(['low', 'moderate', 'elevated', 'critical'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return FORECAST_STATUSES.includes(status) ? status : 'moderate'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceRiskForecast(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-risk-forecast-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    forecastStatus: safeStatus(input.forecastStatus ?? input.status),
    forecastScore: Math.max(0, Math.min(100, Number(input.forecastScore ?? 0))),
    forecastHorizonDays: Math.max(1, Math.min(365, Number(input.forecastHorizonDays ?? 90))),
    forecastSummary: String(input.forecastSummary ?? 'Compliance risk forecast evaluated for human review.').slice(0, 700),
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

export function createComplianceRiskForecastRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const forecast = normalizeComplianceRiskForecast(input)
      if (!database?.connected) return { ok: true, disabled: true, forecast }
      const result = await database.query(
        `INSERT INTO atlas_compliance_risk_forecasts
          (id, organization_id, team_workspace_id, forecast_status, forecast_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET forecast_status = EXCLUDED.forecast_status, forecast_score = EXCLUDED.forecast_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [forecast.id, forecast.tenantScope.organizationId, forecast.tenantScope.teamWorkspaceId, forecast.forecastStatus, forecast.forecastScore, forecast],
      )
      return { ok: true, forecast: normalizeComplianceRiskForecast(result.rows?.[0]?.payload ?? forecast) }
    },
    async list({ tenantContext = {}, forecastStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (forecastStatus) {
        params.push(safeStatus(forecastStatus))
        clauses.push(`forecast_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_risk_forecasts
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceRiskForecast(row.payload))
    },
  }
}

export function evaluateComplianceRiskForecast(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceRiskForecasts ?? []
  const trend = input.complianceTrendAnalytics ?? {}
  const programHealth = input.complianceProgramHealth ?? {}
  const actionItems = input.complianceGovernanceActionItems ?? {}
  const baseRisk = programHealth.programHealthStatus === 'blocked' ? 80 : programHealth.programHealthStatus === 'caution' ? 55 : 25
  const forecastScore = Math.max(0, Math.min(100, baseRisk + ((actionItems.actionItemSummary?.highPriority ?? 0) * 8) + (trend.trendAnalyticsStatus === 'caution' ? 15 : 0)))
  const forecastStatus = forecastScore >= 80 ? 'critical' : forecastScore >= 60 ? 'elevated' : forecastScore >= 35 ? 'moderate' : 'low'
  const forecasts = (supplied.length ? supplied : [normalizeComplianceRiskForecast({
    tenantContext,
    forecastStatus,
    forecastScore,
    forecastSummary: `Compliance risk forecast projects ${forecastStatus} risk from program health ${programHealth.programHealthStatus ?? 'unknown'}, trend status ${trend.trendAnalyticsStatus ?? 'unknown'}, and ${actionItems.actionItemSummary?.highPriority ?? 0} high-priority action items.`,
    sourceReferences: [
      { id: 'compliance-trend-analytics', type: 'compliance-trend-analytics', eventType: trend.eventType },
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: programHealth.eventType },
      { id: 'compliance-action-items', type: 'compliance-governance-action-items', eventType: actionItems.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceRiskForecast)
  const forecastSummary = {
    total: forecasts.length,
    low: forecasts.filter((item) => item.forecastStatus === 'low').length,
    moderate: forecasts.filter((item) => item.forecastStatus === 'moderate').length,
    elevated: forecasts.filter((item) => item.forecastStatus === 'elevated').length,
    critical: forecasts.filter((item) => item.forecastStatus === 'critical').length,
    averageForecastScore: forecasts.length ? Math.round(forecasts.reduce((sum, item) => sum + item.forecastScore, 0) / forecasts.length) : 0,
  }
  const riskForecastStatus = forecastSummary.critical > 0 ? 'blocked' : forecastSummary.elevated > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_RISK_FORECAST_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceRiskForecasts: forecasts,
    forecastSummary,
    riskForecastStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticRemediation: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance risk forecast ${riskForecastStatus}: average forecast score ${forecastSummary.averageForecastScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_RISK_FORECAST_EVALUATED_EVENT, result)
  return result
}
