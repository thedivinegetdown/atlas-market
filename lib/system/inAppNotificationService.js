import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { NOTIFICATION_CATEGORIES, normalizeNotificationPreferences } from './notificationPreferenceService.js'

export const SYSTEM_IN_APP_NOTIFICATION_CREATED_EVENT = 'system.inAppNotification.created'
export const SYSTEM_IN_APP_NOTIFICATION_UPDATED_EVENT = 'system.inAppNotification.updated'

export const IN_APP_NOTIFICATION_SEVERITIES = Object.freeze(['informational', 'caution', 'high', 'critical'])
export const IN_APP_NOTIFICATION_STATUSES = Object.freeze(['unread', 'read', 'archived'])

const SEVERITY_RANK = Object.freeze({
  informational: 0,
  low: 0,
  caution: 1,
  medium: 1,
  high: 2,
  critical: 3,
})

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeCategory(category) {
  return NOTIFICATION_CATEGORIES.includes(category) ? category : 'system health'
}

function safeSeverity(severity) {
  return IN_APP_NOTIFICATION_SEVERITIES.includes(severity) ? severity : 'informational'
}

function safeStatus(status) {
  return IN_APP_NOTIFICATION_STATUSES.includes(status) ? status : 'unread'
}

function normalizeSourceReference(source = {}) {
  return {
    eventType: source.eventType ?? source.type ?? null,
    id: source.id ?? source.eventId ?? null,
  }
}

function inQuietHours(quietHours = {}, now = new Date()) {
  if (quietHours.enabled !== true) return false
  const [startHour] = String(quietHours.start ?? '22:00').split(':').map(Number)
  const [endHour] = String(quietHours.end ?? '07:00').split(':').map(Number)
  const hour = Number.isFinite(now.getHours()) ? now.getHours() : 12
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return false
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour
}

export function normalizeInAppNotification(input = {}) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const severity = safeSeverity(input.severity)
  return {
    id: String(input.id ?? `notification-${input.userId ?? tenantScope.userId ?? 'user'}-${Date.parse(timestamp) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    userId: String(input.userId ?? tenantScope.userId ?? 'local-development:local-operator'),
    category: safeCategory(input.category),
    severity,
    status: safeStatus(input.status),
    title: String(input.title ?? 'Atlas notification').slice(0, 160),
    message: String(input.message ?? input.summary ?? 'Operator review notification.').slice(0, 500),
    sourceEventReference: normalizeSourceReference(input.sourceEventReference ?? input.sourceEvent ?? input.source),
    operatorActionReference: input.operatorActionReference ?? input.operatorActionId ?? null,
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    visible: input.visible !== false,
    deferredByQuietHours: input.deferredByQuietHours === true,
    externalDelivery: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function evaluateNotificationPreference(notificationInput = {}, preferencesInput = {}, options = {}) {
  const notification = normalizeInAppNotification(notificationInput)
  const preferences = normalizeNotificationPreferences({ ...preferencesInput, userId: notification.userId })
  const preference = preferences.categories[notification.category]
  const thresholdRank = SEVERITY_RANK[preference?.severityThreshold] ?? 1
  const severityRank = SEVERITY_RANK[notification.severity] ?? 0
  const criticalSecurityVisible = notification.category === 'security' && notification.severity === 'critical'
  const enabled = preference?.enabled !== false && preference?.channels?.inApp !== false
  const aboveThreshold = severityRank >= thresholdRank
  const quiet = inQuietHours(preferences.quietHours, options.now ?? new Date())
  const deferredByQuietHours = quiet && notification.severity !== 'critical'
  const visible = criticalSecurityVisible || (enabled && aboveThreshold && !deferredByQuietHours)
  return {
    notification: {
      ...notification,
      visible,
      deferredByQuietHours,
      status: visible ? notification.status : 'archived',
    },
    preferences,
    preferenceApplied: true,
    visible,
    deferredByQuietHours,
    criticalSecurityVisible,
    reason: visible ? 'notification visible' : deferredByQuietHours ? 'quiet hours deferred non-critical notification' : 'notification preference suppressed',
  }
}

export function createInAppNotificationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(notificationInput) {
      const notification = normalizeInAppNotification(notificationInput)
      if (!database?.connected) return { ok: true, disabled: true, notification }
      const result = await database.query(
        `INSERT INTO atlas_in_app_notifications
          (id, organization_id, team_workspace_id, user_id, category, severity, status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING id, organization_id, team_workspace_id, user_id, category, severity, status, payload, created_at, updated_at`,
        [
          notification.id,
          notification.tenantScope.organizationId,
          notification.tenantScope.teamWorkspaceId,
          notification.userId,
          notification.category,
          notification.severity,
          notification.status,
          notification,
        ],
      )
      const row = result.rows?.[0]
      return { ok: true, notification: row?.payload ? normalizeInAppNotification(row.payload) : notification }
    },
    async list({ tenantContext = {}, userId, status, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, userId ?? tenantContext.userId, Math.min(100, Math.max(1, Number(limit) || 50))]
      const statusClause = status ? 'AND status = $5' : ''
      if (status) params.push(status)
      const result = await database.query(
        `SELECT payload FROM atlas_in_app_notifications
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           AND user_id = $3
           ${statusClause}
         ORDER BY created_at DESC
         LIMIT $4`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeInAppNotification(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, userId, status }) {
      const safe = safeStatus(status)
      if (!database?.connected) return { ok: true, disabled: true, notification: normalizeInAppNotification({ id, tenantContext, userId, status: safe }) }
      const result = await database.query(
        `UPDATE atlas_in_app_notifications
         SET status = $5,
             payload = jsonb_set(payload, '{status}', to_jsonb($5::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
           AND user_id = $4
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', userId ?? tenantContext.userId, safe],
      )
      return { ok: result.rows?.length > 0, notification: result.rows?.[0]?.payload ? normalizeInAppNotification(result.rows[0].payload) : null }
    },
  }
}

export async function createInAppNotification(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const preferenceDecision = evaluateNotificationPreference(input.notification ?? input, input.preferences, { now: options.now })
  const repository = options.repository ?? createInAppNotificationRepository(options)
  const response = preferenceDecision.visible ? await repository.create(preferenceDecision.notification) : { ok: true, notification: preferenceDecision.notification }
  const result = {
    eventType: SYSTEM_IN_APP_NOTIFICATION_CREATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    normalizedNotificationModel: response.notification,
    notificationCategories: NOTIFICATION_CATEGORIES,
    severity: preferenceDecision.notification.severity,
    notificationStatus: response.notification?.status ?? 'archived',
    preferenceApplied: true,
    quietHoursApplied: preferenceDecision.deferredByQuietHours,
    criticalSecurityVisible: preferenceDecision.criticalSecurityVisible,
    externalDelivery: false,
    sensitiveMaterialExcluded: true,
    status: preferenceDecision.visible ? 'created' : 'suppressed',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_IN_APP_NOTIFICATION_CREATED_EVENT, result)
  return result
}

export async function updateInAppNotificationStatus(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const repository = options.repository ?? createInAppNotificationRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_IN_APP_NOTIFICATION_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    notification: response.notification,
    requestedStatus: safeStatus(input.status),
    status: response.ok ? 'updated' : 'blocked',
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_IN_APP_NOTIFICATION_UPDATED_EVENT, result)
  return result
}
