import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_TREND_ANALYTICS_EVALUATED_EVENT = 'system.complianceTrendAnalytics.evaluated'

export const TREND_STATUSES = Object.freeze(['improving', 'stable', 'deteriorating'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeTrend(status) {
  return TREND_STATUSES.includes(status) ? status : 'stable'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceTrendAnalytics(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-trend-analytics-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    trendStatus: safeTrend(input.trendStatus ?? input.status),
    trendScore: Math.max(0, Math.min(100, Number(input.trendScore ?? 0))),
    healthScoreDelta: Number(input.healthScoreDelta ?? 0),
    openActionDelta: Number(input.openActionDelta ?? 0),
    trendSummary: String(input.trendSummary ?? 'Compliance trend analytics evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceTrendAnalyticsRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const analytics = normalizeComplianceTrendAnalytics(input)
      if (!database?.connected) return { ok: true, disabled: true, analytics }
      const result = await database.query(
        `INSERT INTO atlas_compliance_trend_analytics
          (id, organization_id, team_workspace_id, trend_status, trend_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET trend_status = EXCLUDED.trend_status, trend_score = EXCLUDED.trend_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [analytics.id, analytics.tenantScope.organizationId, analytics.tenantScope.teamWorkspaceId, analytics.trendStatus, analytics.trendScore, analytics],
      )
      return { ok: true, analytics: normalizeComplianceTrendAnalytics(result.rows?.[0]?.payload ?? analytics) }
    },
    async list({ tenantContext = {}, trendStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (trendStatus) {
        params.push(safeTrend(trendStatus))
        clauses.push(`trend_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_trend_analytics
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceTrendAnalytics(row.payload))
    },
  }
}

export function evaluateComplianceTrendAnalytics(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceTrendAnalytics ?? []
  const metrics = input.complianceMetricsSnapshot ?? {}
  const dashboard = input.complianceExecutiveDashboard ?? {}
  const currentScore = dashboard.executiveDashboardSummary?.averageScore ?? metrics.metricsSnapshotSummary?.averageHealthScore ?? 0
  const openActions = metrics.metricsSnapshotSummary?.openActionItems ?? 0
  const trendStatus = currentScore >= 90 && openActions === 0 ? 'improving' : currentScore < 75 || openActions > 3 ? 'deteriorating' : 'stable'
  const analytics = (supplied.length ? supplied : [normalizeComplianceTrendAnalytics({
    tenantContext,
    trendStatus,
    trendScore: currentScore,
    healthScoreDelta: currentScore - 85,
    openActionDelta: openActions,
    trendSummary: `Compliance trend analytics summarizes executive dashboard score ${currentScore} and ${openActions} open action items.`,
    sourceReferences: [
      { id: 'compliance-metrics-snapshot', type: 'compliance-metrics-snapshot', eventType: metrics.eventType },
      { id: 'compliance-executive-dashboard', type: 'compliance-executive-dashboard', eventType: dashboard.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceTrendAnalytics)
  const trendSummary = {
    total: analytics.length,
    improving: analytics.filter((item) => item.trendStatus === 'improving').length,
    stable: analytics.filter((item) => item.trendStatus === 'stable').length,
    deteriorating: analytics.filter((item) => item.trendStatus === 'deteriorating').length,
    averageTrendScore: analytics.length ? Math.round(analytics.reduce((sum, item) => sum + item.trendScore, 0) / analytics.length) : 0,
  }
  const trendAnalyticsStatus = trendSummary.deteriorating > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_TREND_ANALYTICS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceTrendAnalytics: analytics,
    trendSummary,
    trendAnalyticsStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance trend analytics ${trendAnalyticsStatus}: ${trendSummary.improving} improving, ${trendSummary.stable} stable, and ${trendSummary.deteriorating} deteriorating.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_TREND_ANALYTICS_EVALUATED_EVENT, result)
  return result
}
