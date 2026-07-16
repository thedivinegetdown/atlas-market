import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RELEASE_READINESS_EVALUATED_EVENT = 'releaseReadiness.evaluated'

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

function normalizeReadiness(status) {
  if (status === true) return 'healthy'
  if (status === false) return 'blocked'
  const normalized = String(status ?? 'warning').toLowerCase()
  if (['healthy', 'ready', 'valid', 'passed', 'available', 'operational', 'completed', 'reconciled', 'active', 'qualified', 'simulated', 'generated', 'exported', 'downloaded'].includes(normalized)) return 'healthy'
  if (['blocked', 'critical', 'failed', 'error', 'invalid', 'mismatch', 'rejected', 'stale', 'expired'].includes(normalized)) return 'blocked'
  return 'warning'
}

function subsystem(id, label, status, sourceEvent, detail = {}) {
  const readiness = normalizeReadiness(status)
  return {
    id,
    label,
    readiness,
    sourceStatus: status ?? 'not_reported',
    sourceEvent: sourceEvent ?? null,
    message: readiness === 'healthy'
      ? `${label} is healthy for paper-only release review.`
      : readiness === 'warning'
        ? `${label} should be reviewed before release.`
        : `${label} is blocking release readiness.`,
    ...detail,
  }
}

function score(subsystems) {
  if (subsystems.length === 0) return 0
  const total = subsystems.reduce((sum, item) => sum + (item.readiness === 'healthy' ? 100 : item.readiness === 'warning' ? 60 : 0), 0)
  return Math.round(total / subsystems.length)
}

export function evaluateReleaseReadinessDiagnostics(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const accountId = input.accountId ?? 'paper-portfolio'
  const subsystems = [
    subsystem('authentication', 'Authentication', input.authenticationReadiness?.authReadinessStatus, input.authenticationReadiness?.eventType),
    subsystem('authorization', 'Authorization', input.identityAuthorization?.authorizationStatus ?? input.roleBasedPermissionPlanning?.permissionReadinessStatus, input.identityAuthorization?.eventType ?? input.roleBasedPermissionPlanning?.eventType),
    subsystem('api-reliability', 'API reliability', input.apiReliability?.apiReliabilityStatus ?? input.apiReliability?.status, input.apiReliability?.eventType),
    subsystem('market-data', 'Market data', input.marketDataScannerHealth?.healthStatus ?? input.marketDataProviderResilience?.resilienceStatus ?? input.marketDataAdapterHealth?.status, input.marketDataScannerHealth?.eventType ?? input.marketDataProviderResilience?.eventType),
    subsystem('scanner', 'Scanner', input.realtimeScanner?.scannerStatus ?? input.scannerThroughputBackpressure?.scannerStatus ?? input.scannerThroughputBackpressure?.cycleStatus, input.realtimeScanner?.eventType ?? input.scannerThroughputBackpressure?.eventType),
    subsystem('signal-pipeline', 'Signal pipeline', input.realtimeSignals?.signalStatus ?? input.realtimeSignals?.realtimeSignalSummary?.status ?? input.scannerSignal?.signal?.action, input.realtimeSignals?.eventType),
    subsystem('paper-execution', 'Paper execution', input.realtimeSimulatedExecutions?.executionLifecycleStatus ?? input.realtimeSimulatedExecutions?.realtimeSimulatedExecutionSummary?.status, input.realtimeSimulatedExecutions?.eventType),
    subsystem('accounting', 'Accounting', input.primaryAccounting?.accountingStatus ?? input.paperAccounting?.accountingStatus, input.primaryAccounting?.eventType ?? input.paperAccounting?.eventType),
    subsystem('reconciliation', 'Reconciliation', input.realtimePortfolioReconciliation?.reconciliationStatus, input.realtimePortfolioReconciliation?.eventType),
    subsystem('portfolio', 'Portfolio', input.realtimePaperPortfolio?.streamingPortfolioStatus ?? input.portfolioAnalytics?.portfolioStatus ?? input.portfolioAnalytics?.portfolioScoreClassification, input.realtimePaperPortfolio?.eventType ?? input.portfolioAnalytics?.eventType),
    subsystem('risk', 'Risk', input.realtimePaperRisk?.riskStatus ?? input.portfolioRisk?.riskLevel, input.realtimePaperRisk?.eventType ?? input.portfolioRisk?.eventType),
    subsystem('performance', 'Performance', input.realtimePaperPerformance?.performanceStatus ?? input.paperPerformance?.performanceStatus, input.realtimePaperPerformance?.eventType ?? input.paperPerformance?.eventType),
    subsystem('reporting', 'Reporting', input.paperTradingReport?.reportStatus ?? input.paperReport?.reportStatus, input.paperTradingReport?.eventType ?? input.paperReport?.eventType),
    subsystem('jobs', 'Report jobs', input.paperReportJob?.status ?? input.paperReportJob?.paperReportJob?.status, input.paperReportJob?.eventType),
    subsystem('worker', 'Report worker', input.paperReportWorker?.paperReportWorkerRun?.status ?? input.paperReportWorker?.status, input.paperReportWorker?.eventType),
    subsystem('artifacts', 'Report artifacts', input.paperReportArtifact?.status ?? input.paperReportArtifact?.paperReportArtifact?.status, input.paperReportArtifact?.eventType),
    subsystem('operations', 'Paper operations', input.realtimePaperOperations?.operationsStatus, input.realtimePaperOperations?.eventType),
    subsystem('alerts', 'Operational alerts', input.paperOperationsAlerts?.alertingStatus ?? input.paperOperationsAlerts?.alertStatus, input.paperOperationsAlerts?.eventType),
    subsystem('incidents', 'Incidents', input.paperOperationsIncidents?.incidentStatus, input.paperOperationsIncidents?.eventType),
    subsystem('observability', 'Observability', input.paperOperationsObservability?.healthStatus ?? input.eventObservability?.observabilityStatus, input.paperOperationsObservability?.eventType ?? input.eventObservability?.eventType),
  ]
  const deploymentBlockers = subsystems.filter((item) => item.readiness === 'blocked').map((item) => ({ subsystemId: item.id, label: item.label, sourceStatus: item.sourceStatus, message: item.message }))
  const warnings = subsystems.filter((item) => item.readiness === 'warning').map((item) => ({ subsystemId: item.id, label: item.label, sourceStatus: item.sourceStatus, message: item.message }))
  const releaseReadinessStatus = deploymentBlockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'healthy'
  const result = {
    eventType: RELEASE_READINESS_EVALUATED_EVENT,
    timestamp,
    tenantScope: scope,
    accountId,
    releaseReadinessStatus,
    readinessScore: score(subsystems),
    subsystemReadiness: subsystems,
    deploymentBlockers,
    warnings,
    recommendations: [
      ...deploymentBlockers.slice(0, 5).map((item) => `Resolve ${item.label} before deployment review.`),
      ...warnings.slice(0, 5).map((item) => `Review ${item.label} warning before release signoff.`),
      'Keep release diagnostics read-only and paper-trading scoped.',
    ],
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
    summary: `Release readiness ${releaseReadinessStatus}: ${deploymentBlockers.length} blockers, ${warnings.length} warnings, score ${score(subsystems)}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(RELEASE_READINESS_EVALUATED_EVENT, result)
  return result
}

export function createReleaseReadinessDiagnosticsRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const snapshot = input.releaseReadinessDiagnostics ?? input
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      const result = await database.query(
        `INSERT INTO atlas_release_readiness_diagnostics
          (id, organization_id, team_workspace_id, account_id, readiness_status, readiness_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET readiness_status = EXCLUDED.readiness_status, readiness_score = EXCLUDED.readiness_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [snapshot.id ?? `release-readiness-${snapshot.accountId}-${Date.parse(snapshot.timestamp) || Date.now()}`, snapshot.tenantScope.organizationId, snapshot.tenantScope.teamWorkspaceId, snapshot.accountId, snapshot.releaseReadinessStatus, snapshot.readinessScore, snapshot],
      )
      return { ok: true, snapshot: result.rows?.[0]?.payload ?? snapshot }
    },
    async list({ tenantContext = {}, accountId, readinessStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (readinessStatus) { params.push(String(readinessStatus)); clauses.push(`readiness_status = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_readiness_diagnostics
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
