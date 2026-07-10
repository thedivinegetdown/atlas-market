import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { NOTIFICATION_CATEGORIES, normalizeNotificationPreferences } from './notificationPreferenceService.js'
import { normalizeInAppNotification } from './inAppNotificationService.js'

export const SYSTEM_NOTIFICATION_DIGEST_GENERATED_EVENT = 'system.notificationDigest.generated'

const DIGEST_FREQUENCIES = Object.freeze(['realtime', 'hourly', 'daily'])
const SEVERITY_RANK = Object.freeze({ informational: 0, caution: 1, high: 2, critical: 3 })

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0
}

function safeFrequency(frequency) {
  return DIGEST_FREQUENCIES.includes(frequency) ? frequency : 'hourly'
}

function groupByCategory(notifications) {
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => {
    const categoryItems = notifications.filter((notification) => notification.category === category)
    return [category, {
      category,
      count: categoryItems.length,
      unread: categoryItems.filter((notification) => notification.status === 'unread').length,
      highestSeverity: categoryItems.sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0]?.severity ?? 'informational',
    }]
  }))
}

export function normalizeNotificationDigest(input = {}) {
  const timestamp = input.generatedAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const notifications = (input.notifications ?? []).map(normalizeInAppNotification)
  const frequency = safeFrequency(input.frequency)
  return {
    id: String(input.id ?? `notification-digest-${tenantScope.userId ?? input.userId ?? 'user'}-${Date.parse(timestamp) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    userId: String(input.userId ?? tenantScope.userId ?? 'local-development:local-operator'),
    frequency,
    generatedAt: timestamp,
    notificationCount: notifications.length,
    unreadCount: notifications.filter((notification) => notification.status === 'unread').length,
    criticalCount: notifications.filter((notification) => notification.severity === 'critical').length,
    categorySummary: groupByCategory(notifications),
    digestItems: notifications.map((notification) => ({
      id: notification.id,
      category: notification.category,
      severity: notification.severity,
      status: notification.status,
      title: notification.title,
      sourceEventReference: notification.sourceEventReference,
    })),
    externalDelivery: false,
    emailWebhookPlaceholderOnly: true,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createNotificationDigestRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async save(digestInput) {
      const digest = normalizeNotificationDigest(digestInput)
      if (!database?.connected) return { ok: true, disabled: true, digest }
      const result = await database.query(
        `INSERT INTO atlas_notification_digests
          (id, organization_id, team_workspace_id, user_id, frequency, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id)
         DO UPDATE SET payload = EXCLUDED.payload, frequency = EXCLUDED.frequency
         RETURNING payload`,
        [digest.id, digest.tenantScope.organizationId, digest.tenantScope.teamWorkspaceId, digest.userId, digest.frequency, digest],
      )
      return { ok: true, digest: normalizeNotificationDigest(result.rows?.[0]?.payload ?? digest) }
    },
    async list({ tenantContext = {}, userId, limit = 20 } = {}) {
      if (!database?.connected) return []
      const result = await database.query(
        `SELECT payload FROM atlas_notification_digests
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           AND user_id = $3
         ORDER BY created_at DESC
         LIMIT $4`,
        [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', userId ?? tenantContext.userId, Math.min(100, Math.max(1, Number(limit) || 20))],
      )
      return (result.rows ?? []).map((row) => normalizeNotificationDigest(row.payload))
    },
  }
}

export async function generateNotificationDigest(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const preferences = normalizeNotificationPreferences({ ...input.preferences, userId: input.userId ?? input.tenantContext?.userId })
  const notifications = (input.notifications ?? []).map(normalizeInAppNotification)
  const visibleNotifications = notifications.filter((notification) => {
    const preference = preferences.categories[notification.category]
    if (notification.category === 'security' && notification.severity === 'critical') return true
    return preference?.enabled !== false && preference?.channels?.inApp !== false && notification.visible !== false
  })
  const digest = normalizeNotificationDigest({
    id: input.id,
    userId: input.userId,
    tenantContext: input.tenantContext,
    notifications: visibleNotifications,
    frequency: input.frequency,
    timestamp: options.timestamp,
  })
  const repository = options.repository ?? null
  if (repository?.save) await repository.save(digest)
  const result = {
    eventType: SYSTEM_NOTIFICATION_DIGEST_GENERATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    normalizedNotificationDigest: digest,
    digestFrequency: digest.frequency,
    categorySummary: digest.categorySummary,
    criticalSecurityVisible: visibleNotifications.some((notification) => notification.category === 'security' && notification.severity === 'critical'),
    preferenceApplied: true,
    externalDelivery: false,
    status: digest.criticalCount > 0 ? 'caution' : 'healthy',
    summary: `Notification digest ${digest.criticalCount > 0 ? 'caution' : 'healthy'}: ${digest.notificationCount} visible in-app notifications summarized.`,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_NOTIFICATION_DIGEST_GENERATED_EVENT, result)
  return result
}
