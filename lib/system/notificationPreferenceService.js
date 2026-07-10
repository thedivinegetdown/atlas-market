import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_NOTIFICATION_PREFERENCES_UPDATED_EVENT = 'system.notificationPreferences.updated'

export const NOTIFICATION_CATEGORIES = Object.freeze([
  'system health',
  'security',
  'collaboration',
  'access review',
  'strategy research',
  'paper-trading risk',
  'release operations',
])

const SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function categoryPreference(category, input = {}) {
  return {
    category,
    enabled: input.enabled !== false,
    severityThreshold: SEVERITIES.includes(input.severityThreshold) ? input.severityThreshold : 'medium',
    channels: {
      inApp: input.channels?.inApp !== false,
      emailReadyPlaceholder: input.channels?.emailReadyPlaceholder === true,
      webhookReadyPlaceholder: input.channels?.webhookReadyPlaceholder === true,
    },
  }
}

export function normalizeNotificationPreferences(input = {}) {
  const categories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [
    category,
    categoryPreference(category, input.categories?.[category]),
  ]))
  return {
    userId: String(input.userId ?? 'local-development:local-operator'),
    categories,
    quietHours: {
      enabled: input.quietHours?.enabled === true,
      start: input.quietHours?.start ?? '22:00',
      end: input.quietHours?.end ?? '07:00',
      timezone: input.quietHours?.timezone ?? 'America/New_York',
    },
    organizationPolicyOverridePlanningOnly: true,
    externalProvidersConfigured: false,
    secretsStored: false,
  }
}

export function createNotificationPreferenceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async getPreferences(userId) {
      if (!database?.connected) return normalizeNotificationPreferences({ userId })
      const result = await database.query('SELECT user_id, preferences FROM atlas_notification_preferences WHERE user_id = $1', [userId])
      return result.rows?.[0] ? normalizeNotificationPreferences({ userId: result.rows[0].user_id, ...result.rows[0].preferences }) : normalizeNotificationPreferences({ userId })
    },
    async upsertPreferences(preferences) {
      const normalized = normalizeNotificationPreferences(preferences)
      if (!database?.connected) return { ok: true, disabled: true, preferences: normalized }
      const result = await database.query(
        `INSERT INTO atlas_notification_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW()
         RETURNING user_id, preferences`,
        [normalized.userId, normalized],
      )
      const row = result.rows?.[0] ?? { user_id: normalized.userId, preferences: normalized }
      return { ok: true, preferences: normalizeNotificationPreferences({ userId: row.user_id, ...row.preferences }) }
    },
  }
}

export async function updateNotificationPreferences(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const actorUserId = input.actorUserId ?? input.user?.id
  const preferences = normalizeNotificationPreferences({ ...input.preferences, userId: input.targetUserId ?? input.preferences?.userId ?? actorUserId })
  if (!actorUserId || actorUserId !== preferences.userId) {
    const error = new Error('notification preference update denied')
    error.code = 'notification_preference_update_denied'
    error.statusCode = 403
    throw error
  }
  const repository = options.repository ?? createNotificationPreferenceRepository(options)
  const response = await repository.upsertPreferences(preferences)
  const result = {
    eventType: SYSTEM_NOTIFICATION_PREFERENCES_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    normalizedNotificationPreferenceModel: response.preferences,
    preferenceCategories: NOTIFICATION_CATEGORIES,
    channelPlanning: {
      inAppFunctional: true,
      emailReadyPlaceholder: true,
      webhookReadyPlaceholder: true,
      externalProviderIntegration: false,
    },
    severityThresholds: SEVERITIES,
    quietHoursConfiguration: response.preferences.quietHours,
    organizationPolicyOverridePlanningOnly: true,
    secretsStored: false,
    status: response.ok ? 'updated' : 'blocked',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_NOTIFICATION_PREFERENCES_UPDATED_EVENT, result)
  return result
}
