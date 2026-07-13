import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { summarizeIncidents } from './paperOperationsIncidentManagementEngine.js'

export const PAPER_OPERATIONS_OBSERVABILITY_UPDATED_EVENT = 'paperOperations.observability.updated'
export const PAPER_OPERATIONS_HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'critical'])

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function tenantScope(input = {}) {
  const tenant = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenant.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenant.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenant.userId ?? input.userId ?? null,
    role: tenant.role ?? input.role ?? null,
  }
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function ratio(numerator, denominator) {
  const total = numberValue(denominator)
  return total <= 0 ? 0 : Number((numberValue(numerator) / total).toFixed(4))
}

function ageMs(timestamp, now) {
  const then = new Date(timestamp ?? now).getTime()
  const current = new Date(now).getTime()
  return Number.isFinite(then) && Number.isFinite(current) ? Math.max(0, current - then) : 0
}

function statusFromCounts({ critical = 0, degraded = 0, stale = false, missingTenant = false }) {
  if (missingTenant || critical > 0) return 'critical'
  if (degraded > 0 || stale) return 'degraded'
  return 'healthy'
}

export function evaluatePaperOperationsObservability(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const accountId = input.accountId ?? 'paper-portfolio'
  const alerts = input.paperOperationsAlerts ?? input.alerts ?? []
  const incidents = input.paperOperationsIncidents ?? input.incidents ?? []
  const operations = input.realtimePaperOperations ?? {}
  const risk = input.realtimePaperRisk ?? {}
  const performance = input.realtimePaperPerformance ?? {}
  const execution = input.realtimeSimulatedExecutions ?? {}
  const reconciliation = input.realtimePortfolioReconciliation ?? {}
  const apiReliability = input.apiReliability ?? {}
  const apiTotal = numberValue(apiReliability.totalRequests ?? apiReliability.requestCount)
  const apiFailures = numberValue(apiReliability.failedRequests ?? apiReliability.failureCount)
  const executionSummary = execution.realtimeSimulatedExecutionSummary ?? {}
  const reconciliationSummary = reconciliation.realtimePortfolioReconciliationSummary ?? {}
  const openAlerts = alerts.filter((alert) => alert.status !== 'resolved')
  const incidentSummary = summarizeIncidents(incidents)
  const staleAfterMs = Math.max(1000, Number(input.observabilityPolicy?.staleAfterMs ?? 300000))
  const riskAge = ageMs(risk.timestamp ?? risk.realtimePaperRiskSnapshot?.updatedAt, timestamp)
  const performanceAge = ageMs(performance.timestamp ?? performance.realtimePaperPerformanceSnapshot?.updatedAt, timestamp)
  const criticalSignals = openAlerts.filter((alert) => alert.severity === 'critical').length + incidentSummary.critical
  const degradedSignals = openAlerts.filter((alert) => alert.severity === 'warning').length
    + (operations.operationsStatus === 'degraded' || operations.operationsStatus === 'caution' ? 1 : 0)
    + (performance.performanceStatus === 'stale' ? 1 : 0)
  const healthStatus = statusFromCounts({
    critical: criticalSignals,
    degraded: degradedSignals,
    stale: riskAge > staleAfterMs || performanceAge > staleAfterMs,
    missingTenant: !scope.organizationId || !scope.userId,
  })
  const snapshot = {
    id: String(input.id ?? `paper-operations-observability-${accountId}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId,
    healthStatus,
    apiReliabilityMetrics: {
      successRate: ratio(apiTotal - apiFailures, apiTotal),
      failureRate: ratio(apiFailures, apiTotal),
      totalRequests: apiTotal,
    },
    providerMetrics: {
      providerStatus: input.providerHealth?.healthStatus ?? input.providerHealth?.providerStatus ?? 'referenced',
      streamFreshness: input.streamingOperations?.operationalStatus ?? input.marketDataStreamingRouting?.routingStatus ?? 'referenced',
    },
    scannerMetrics: {
      scannerStatus: input.realtimeScanner?.scannerStatus ?? 'referenced',
      signalThroughput: input.realtimeSignals?.realtimeSignalEvaluations?.length ?? 0,
      alertThroughput: input.realtimeAlerts?.realtimeAlertSummary?.total ?? 0,
    },
    paperDecisionMetrics: {
      approved: input.realtimePaperDecisions?.realtimePaperDecisionSummary?.approved ?? 0,
      rejected: input.realtimePaperDecisions?.realtimePaperDecisionSummary?.rejected ?? 0,
    },
    guardrailMetrics: {
      ready: input.realtimePreparedTrades?.realtimePreparedTradeSummary?.ready ?? 0,
      blocked: input.realtimePreparedTrades?.realtimePreparedTradeSummary?.blocked ?? 0,
      blockRate: ratio(input.realtimePreparedTrades?.realtimePreparedTradeSummary?.blocked, (input.realtimePreparedTrades?.realtimePreparedTradeSummary?.ready ?? 0) + (input.realtimePreparedTrades?.realtimePreparedTradeSummary?.blocked ?? 0)),
    },
    executionMetrics: {
      simulated: executionSummary.simulated ?? 0,
      failed: executionSummary.failed ?? 0,
      failureRate: ratio(executionSummary.failed, (executionSummary.simulated ?? 0) + (executionSummary.failed ?? 0)),
    },
    reconciliationMetrics: {
      reconciled: reconciliationSummary.reconciled ?? 0,
      mismatches: reconciliationSummary.mismatch ?? 0,
      mismatchRate: ratio(reconciliationSummary.mismatch, (reconciliationSummary.reconciled ?? 0) + (reconciliationSummary.mismatch ?? 0)),
    },
    riskMetrics: {
      riskStatus: risk.riskStatus ?? 'missing',
      snapshotAgeMs: riskAge,
    },
    performanceMetrics: {
      performanceStatus: performance.performanceStatus ?? 'missing',
      snapshotAgeMs: performanceAge,
      totalTrades: performance.realtimePaperPerformanceSummary?.totalTrades ?? 0,
    },
    alertMetrics: {
      open: openAlerts.length,
      critical: openAlerts.filter((alert) => alert.severity === 'critical').length,
      warning: openAlerts.filter((alert) => alert.severity === 'warning').length,
      info: openAlerts.filter((alert) => alert.severity === 'info').length,
    },
    incidentMetrics: incidentSummary,
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
  const result = {
    eventType: PAPER_OPERATIONS_OBSERVABILITY_UPDATED_EVENT,
    timestamp,
    paperOperationsObservabilitySnapshot: snapshot,
    paperOperationsObservabilitySummary: {
      healthStatus,
      openAlerts: snapshot.alertMetrics.open,
      openIncidents: incidentSummary.total - incidentSummary.resolved,
      apiFailureRate: snapshot.apiReliabilityMetrics.failureRate,
      executionFailureRate: snapshot.executionMetrics.failureRate,
      reconciliationMismatchRate: snapshot.reconciliationMetrics.mismatchRate,
    },
    healthStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Paper operations observability ${healthStatus}: compact health, alert, incident, execution, reconciliation, risk, and performance metrics updated.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_OPERATIONS_OBSERVABILITY_UPDATED_EVENT, result)
  return result
}

export function createPaperOperationsObservabilityRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const snapshot = input.paperOperationsObservabilitySnapshot ?? input
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_paper_operations_observability_snapshots
          (id, organization_id, team_workspace_id, account_id, health_status, snapshot_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET health_status = EXCLUDED.health_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [snapshot.id, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.accountId, snapshot.healthStatus, snapshot.createdAt, snapshot],
      )
      return { ok: true, snapshot: result.rows?.[0]?.payload ?? snapshot }
    },
    async list({ tenantContext = {}, accountId, healthStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) {
        params.push(String(accountId))
        clauses.push(`account_id = $${params.length}`)
      }
      if (healthStatus) {
        params.push(String(healthStatus))
        clauses.push(`health_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_operations_observability_snapshots
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY snapshot_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
