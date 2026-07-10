import { createNotificationPreferenceRepository } from '../../lib/system/notificationPreferenceService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createNotificationPreferencesHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user }) => {
    const repository = options.preferenceRepository ?? createNotificationPreferenceRepository(options)
    const preferences = await repository.getPreferences?.(user.id)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'notification-preferences' }),
      preferences,
      externalProvidersConfigured: false,
      secretsStored: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'notification-preferences',
    ...options,
  })
}

export const handler = createNotificationPreferencesHandler()
