import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_OPERATIONS_ALERT_UPDATED_EVENT = 'paperOperations.alert.updated'
export const PAPER_OPERATIONS_ALERT_SEVERITIES = Object.freeze(['info', 'warning', 'critical'])
export const PAPER_OPERATIONS_ALERT_STATUSES = Object.freeze(['open', 'acknowledged', 'resolved'])

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

function safeSeverity(severity) {
  return PAPER_OPERATIONS_ALERT_SEVERITIES.includes(severity) ? severity : 'info'
}

function safeStatus(status) {
  return PAPER_OPERATIONS_ALERT_STATUSES.includes(status) ? status : 'open'
}

function fingerprint(category, source, status) {
  return `paper-ops:${category}:${source}:${status}`.toLowerCase().replace(/[^a-z0-9:-]+/g, '-').slice(0, 180)
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.sourceId ?? null,
    eventType: reference.eventType ?? null,
    status: reference.status ?? reference.operationsStatus ?? reference.riskStatus ?? reference.performanceStatus ?? null,
  }
}

function candidate(category, severity, source, message, references = []) {
  const normalizedSeverity = safeSeverity(severity)
  const sourceId = String(source ?? category)
  return {
    category,
    severity: normalizedSeverity,
    source: sourceId,
    message,
    fingerprint: fingerprint(category, sourceId, normalizedSeverity),
    supportingReferences: references.slice(0, 12).map(normalizeReference),
  }
}

function existingByFingerprint(existingAlerts = []) {
  return new Map(existingAlerts.map((alert) => [alert.fingerprint, alert]))
}

export function normalizePaperOperationsAlert(input = {}, index = 0) {
  const timestamp = input.lastSeenAt ?? input.updatedAt ?? input.firstSeenAt ?? input.timestamp ?? nowIso()
  return {
    id: String(input.id ?? `paper-operations-alert-${input.fingerprint ?? index}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: tenantScope(input),
    accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
    fingerprint: String(input.fingerprint ?? `paper-operations-alert-${index}`).slice(0, 220),
    category: String(input.category ?? 'operations').slice(0, 80),
    severity: safeSeverity(input.severity),
    status: safeStatus(input.status),
    source: String(input.source ?? 'paper-operations').slice(0, 120),
    message: String(input.message ?? 'Paper operations alert').slice(0, 500),
    supportingReferences: (input.supportingReferences ?? []).slice(0, 20).map(normalizeReference),
    firstSeenAt: input.firstSeenAt ?? timestamp,
    lastSeenAt: input.lastSeenAt ?? timestamp,
    occurrenceCount: Math.max(1, Number(input.occurrenceCount) || 1),
    acknowledgedAt: input.acknowledgedAt ?? null,
    resolvedAt: input.resolvedAt ?? null,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function evaluatePaperOperationsAlerts(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const accountId = input.accountId ?? 'paper-portfolio'
  const operations = input.realtimePaperOperations ?? {}
  const risk = input.realtimePaperRisk ?? {}
  const performance = input.realtimePaperPerformance ?? {}
  const reconciliation = input.realtimePortfolioReconciliation ?? {}
  const execution = input.realtimeSimulatedExecutions ?? {}
  const routed = input.marketDataStreamingRouting ?? {}
  const providerHealth = input.marketDataProviderHealth ?? input.providerHealth ?? {}
  const existingMap = existingByFingerprint(input.existingAlerts ?? [])
  const sections = operations.realtimePaperOperationsSections ?? []
  const candidates = []

  for (const section of sections.slice(0, 20)) {
    if (section.status === 'blocked') candidates.push(candidate('operational-snapshot', 'critical', section.id, `${section.label} is blocked.`, [section, operations]))
    if (section.status === 'degraded') candidates.push(candidate('operational-snapshot', 'critical', section.id, `${section.label} is degraded.`, [section, operations]))
    if (section.status === 'caution') candidates.push(candidate('operational-snapshot', 'warning', section.id, `${section.label} requires review.`, [section, operations]))
  }
  if (!operations.eventType) candidates.push(candidate('missing-operational-snapshot', 'critical', 'paper-operations', 'Real-time paper operations snapshot is missing.', []))
  if (routed.routingStatus === 'stale' || routed.routingStatus === 'rejected') candidates.push(candidate('market-data-freshness', 'warning', 'streaming-router', 'Market data routing is stale or rejected.', [routed]))
  if (providerHealth.healthStatus === 'degraded' || providerHealth.providerStatus === 'degraded') candidates.push(candidate('provider-health', 'warning', 'market-data-provider', 'Provider health is degraded.', [providerHealth]))
  if ((execution.realtimeSimulatedExecutionSummary?.failed ?? 0) > 0) candidates.push(candidate('simulated-execution-failure', 'critical', 'paper-execution', 'Simulated execution failures detected.', [execution]))
  if (reconciliation.reconciliationStatus === 'mismatch') candidates.push(candidate('portfolio-reconciliation', 'critical', 'portfolio-reconciliation', 'Portfolio reconciliation mismatch detected.', [reconciliation]))
  if (['elevated', 'blocked'].includes(risk.riskStatus)) candidates.push(candidate('paper-risk', risk.riskStatus === 'blocked' ? 'critical' : 'warning', 'risk-monitor', 'Paper risk monitor requires review.', [risk]))
  if (risk.realtimePaperRiskSnapshot?.drawdownRiskSummary?.status === 'locked') candidates.push(candidate('drawdown-escalation', 'critical', 'drawdown-protection', 'Drawdown protection is locked.', [risk]))
  if (performance.performanceStatus === 'stale') candidates.push(candidate('performance-freshness', 'warning', 'performance-stream', 'Paper performance snapshot is stale.', [performance]))

  const activeFingerprints = new Set(candidates.map((item) => item.fingerprint))
  const updatedAlerts = candidates.slice(0, 50).map((item, index) => {
    const existing = existingMap.get(item.fingerprint)
    return normalizePaperOperationsAlert({
      ...item,
      tenantContext: scope,
      accountId,
      id: existing?.id,
      status: existing?.status === 'acknowledged' ? 'acknowledged' : 'open',
      firstSeenAt: existing?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      occurrenceCount: (existing?.occurrenceCount ?? 0) + 1,
      acknowledgedAt: existing?.acknowledgedAt ?? null,
      timestamp,
    }, index)
  })
  const resolvedAlerts = (input.existingAlerts ?? [])
    .filter((alert) => alert.status !== 'resolved' && !activeFingerprints.has(alert.fingerprint))
    .slice(0, 50)
    .map((alert, index) => normalizePaperOperationsAlert({ ...alert, status: 'resolved', resolvedAt: timestamp, lastSeenAt: alert.lastSeenAt ?? timestamp, updatedAt: timestamp }, index))
  const alerts = [...updatedAlerts, ...resolvedAlerts]
  const result = {
    eventType: PAPER_OPERATIONS_ALERT_UPDATED_EVENT,
    timestamp,
    tenantScope: scope,
    accountId,
    paperOperationsAlerts: alerts,
    paperOperationsAlertSummary: {
      open: alerts.filter((alert) => alert.status === 'open').length,
      acknowledged: alerts.filter((alert) => alert.status === 'acknowledged').length,
      resolved: alerts.filter((alert) => alert.status === 'resolved').length,
      critical: alerts.filter((alert) => alert.severity === 'critical' && alert.status !== 'resolved').length,
      warning: alerts.filter((alert) => alert.severity === 'warning' && alert.status !== 'resolved').length,
      info: alerts.filter((alert) => alert.severity === 'info' && alert.status !== 'resolved').length,
    },
    alertingStatus: alerts.some((alert) => alert.severity === 'critical' && alert.status !== 'resolved') ? 'critical' : alerts.some((alert) => alert.status !== 'resolved') ? 'degraded' : 'healthy',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Paper operations alerting evaluated ${alerts.length} bounded alert records.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_OPERATIONS_ALERT_UPDATED_EVENT, result)
  return result
}

export function createPaperOperationsAlertRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async upsert(alert) {
      const normalized = normalizePaperOperationsAlert(alert)
      if (!database?.connected) return { ok: true, disabled: true, alert: normalized }
      const result = await database.query(
        `INSERT INTO atlas_paper_operations_alerts
          (id, organization_id, team_workspace_id, account_id, fingerprint, category, severity, status, payload, first_seen_at, last_seen_at, resolved_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
         ON CONFLICT (organization_id, account_id, fingerprint)
         DO UPDATE SET severity = EXCLUDED.severity, status = EXCLUDED.status, payload = EXCLUDED.payload, last_seen_at = EXCLUDED.last_seen_at, resolved_at = EXCLUDED.resolved_at, updated_at = NOW()
         RETURNING payload`,
        [normalized.id, normalized.tenantScope.organizationId, normalized.tenantScope.teamWorkspaceId, normalized.accountId, normalized.fingerprint, normalized.category, normalized.severity, normalized.status, normalized, normalized.firstSeenAt, normalized.lastSeenAt, normalized.resolvedAt],
      )
      return { ok: true, alert: normalizePaperOperationsAlert(result.rows?.[0]?.payload ?? normalized) }
    },
    async list({ tenantContext = {}, accountId, status, severity, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) {
        params.push(String(accountId))
        clauses.push(`account_id = $${params.length}`)
      }
      if (status) {
        params.push(safeStatus(status))
        clauses.push(`status = $${params.length}`)
      }
      if (severity) {
        params.push(safeSeverity(severity))
        clauses.push(`severity = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_operations_alerts
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizePaperOperationsAlert(row.payload))
    },
  }
}
