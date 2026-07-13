import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { evaluateNotificationPreference } from '../system/inAppNotificationService.js'

export const ALERTS_REALTIME_CREATED_EVENT = 'alerts.realtime.created'
export const ALERTS_REALTIME_UPDATED_EVENT = 'alerts.realtime.updated'
export const REALTIME_ALERT_SEVERITIES = Object.freeze(['informational', 'caution', 'high', 'critical'])
export const REALTIME_ALERT_LIFECYCLES = Object.freeze(['open', 'acknowledged', 'resolved', 'expired'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeSeverity(severity) {
  return REALTIME_ALERT_SEVERITIES.includes(severity) ? severity : 'informational'
}

function safeLifecycle(status) {
  return REALTIME_ALERT_LIFECYCLES.includes(status) ? status : 'open'
}

function severityForSignal(signal = {}) {
  if (signal.signalStatus === 'qualified' && signal.signalConfidence >= 90) return 'critical'
  if (signal.signalStatus === 'qualified') return 'high'
  if (signal.signalStatus === 'watchlist') return 'caution'
  return 'informational'
}

export function normalizeRealtimeAlert(input = {}, index = 0) {
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  return {
    id: String(input.id ?? `realtime-alert-${input.symbol ?? 'SPY'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    symbol: String(input.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(input.assetType ?? 'etf').toLowerCase().slice(0, 40),
    severity: safeSeverity(input.severity),
    lifecycle: safeLifecycle(input.lifecycle ?? input.status),
    title: String(input.title ?? `${input.symbol ?? 'SPY'} real-time signal alert`).slice(0, 180),
    message: String(input.message ?? 'Real-time paper signal alert requires operator review.').slice(0, 600),
    sourceScannerReference: input.sourceScannerReference ?? null,
    sourceSignalReference: input.sourceSignalReference ?? null,
    notificationPreferenceCompatibility: input.notificationPreferenceCompatibility ?? { compatible: true, category: 'strategy research' },
    inAppNotificationCompatibility: input.inAppNotificationCompatibility ?? { compatible: true, externalDelivery: false },
    operatorActionCompatibility: input.operatorActionCompatibility ?? { compatible: true, humanReviewOnly: true },
    deduplicationKey: String(input.deduplicationKey ?? `${input.symbol ?? 'SPY'}:${input.sourceSignalReference?.id ?? 'signal'}`).slice(0, 260),
    cooldownUntil: input.cooldownUntil ?? null,
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimeAlertRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const alert = normalizeRealtimeAlert(input)
      if (!database?.connected) return { ok: true, disabled: true, alert }
      const result = await database.query(
        `INSERT INTO atlas_realtime_alerts
          (id, organization_id, team_workspace_id, alert_status, severity, symbol, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET alert_status = EXCLUDED.alert_status, severity = EXCLUDED.severity, symbol = EXCLUDED.symbol, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [alert.id, alert.tenantScope.organizationId, alert.tenantScope.teamWorkspaceId, alert.lifecycle, alert.severity, alert.symbol, alert],
      )
      return { ok: true, alert: normalizeRealtimeAlert(result.rows?.[0]?.payload ?? alert) }
    },
    async list({ tenantContext = {}, lifecycle, symbol, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (lifecycle) {
        params.push(safeLifecycle(lifecycle))
        clauses.push(`alert_status = $${params.length}`)
      }
      if (symbol) {
        params.push(String(symbol).toUpperCase())
        clauses.push(`symbol = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_alerts
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimeAlert(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, lifecycle }) {
      const safe = safeLifecycle(lifecycle)
      if (!database?.connected) return { ok: true, disabled: true, alert: normalizeRealtimeAlert({ id, tenantContext, lifecycle: safe }) }
      const result = await database.query(
        `UPDATE atlas_realtime_alerts
         SET alert_status = $4,
             payload = jsonb_set(payload, '{lifecycle}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, safe],
      )
      return { ok: result.rows?.length > 0, alert: result.rows?.[0]?.payload ? normalizeRealtimeAlert(result.rows[0].payload) : null }
    },
  }
}

export function createRealtimeAlerts(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const signals = input.realtimeSignals?.realtimeSignalEvaluations ?? input.signals ?? []
  const existingAlerts = input.existingAlerts ?? []
  const existingDedupKeys = new Set(existingAlerts.map((alert) => alert.deduplicationKey))
  const deduplicationWindowMs = Math.max(1000, Number(input.alertPolicy?.deduplicationWindowMs ?? 300000))
  const cooldownMs = Math.max(1000, Number(input.alertPolicy?.cooldownMs ?? 600000))
  const alerts = []
  for (const signal of signals.slice(0, 100)) {
    if (!['qualified', 'watchlist'].includes(signal.signalStatus)) continue
    const deduplicationKey = `${signal.symbol}:${signal.signalStatus}:${signal.sourceEventReferences?.[0]?.id ?? signal.id}`
    if (existingDedupKeys.has(deduplicationKey)) continue
    const severity = severityForSignal(signal)
    const preferenceDecision = evaluateNotificationPreference({
      tenantContext,
      userId: tenantContext.userId,
      category: 'strategy research',
      severity,
      title: `${signal.symbol} ${signal.signalStatus} real-time signal`,
      message: signal.signalRationale,
      sourceEventReference: { id: signal.id, eventType: signal.eventType ?? 'signal.realtime.evaluated' },
    }, input.notificationPreferences, { now: new Date(timestamp) })
    alerts.push(normalizeRealtimeAlert({
      tenantContext,
      id: `realtime-alert-${signal.id}`,
      symbol: signal.symbol,
      assetType: signal.assetType,
      severity,
      lifecycle: 'open',
      title: `${signal.symbol} ${signal.signalStatus} real-time signal`,
      message: signal.signalRationale,
      sourceScannerReference: signal.scannerCandidateReference,
      sourceSignalReference: { id: signal.id, eventType: SIGNAL_REALTIME_EVENT_REFERENCE },
      notificationPreferenceCompatibility: { compatible: preferenceDecision.preferenceApplied, category: 'strategy research', visible: preferenceDecision.visible },
      inAppNotificationCompatibility: { compatible: true, externalDelivery: false, visible: preferenceDecision.visible },
      operatorActionCompatibility: { compatible: true, humanReviewOnly: true },
      deduplicationKey,
      cooldownUntil: getNowIso(new Date(new Date(timestamp).getTime() + cooldownMs)),
      timestamp,
    }))
  }
  const realtimeAlertSummary = {
    total: alerts.length,
    informational: alerts.filter((item) => item.severity === 'informational').length,
    caution: alerts.filter((item) => item.severity === 'caution').length,
    high: alerts.filter((item) => item.severity === 'high').length,
    critical: alerts.filter((item) => item.severity === 'critical').length,
    deduplicationWindowMs,
    cooldownMs,
    duplicateSuppressed: signals.filter((signal) => existingDedupKeys.has(`${signal.symbol}:${signal.signalStatus}:${signal.sourceEventReferences?.[0]?.id ?? signal.id}`)).length,
  }
  const result = {
    eventType: ALERTS_REALTIME_CREATED_EVENT,
    timestamp,
    realtimeAlerts: alerts,
    realtimeAlertSummary,
    alertPolicy: {
      deduplicationWindowMs,
      cooldownMs,
      sourceScannerSignalReferences: true,
      notificationPreferenceCompatible: true,
      inAppNotificationCompatible: true,
      operatorActionCompatible: true,
    },
    alertPipelineStatus: alerts.length > 0 ? 'created' : 'idle',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time alert pipeline created ${alerts.length} paper-only operator alerts with cooldown and deduplication controls.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(ALERTS_REALTIME_CREATED_EVENT, result)
  return result
}

export function updateRealtimeAlertLifecycle(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const alert = normalizeRealtimeAlert({ ...input.alert, id: input.id ?? input.alert?.id, tenantContext: input.tenantContext, lifecycle: input.lifecycle ?? input.status })
  const result = {
    eventType: ALERTS_REALTIME_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    realtimeAlert: alert,
    requestedLifecycle: alert.lifecycle,
    alertPipelineStatus: 'updated',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(ALERTS_REALTIME_UPDATED_EVENT, result)
  return result
}

const SIGNAL_REALTIME_EVENT_REFERENCE = 'signal.realtime.evaluated'
