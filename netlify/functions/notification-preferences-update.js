import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createNotificationPreferenceRepository, updateNotificationPreferences } from '../../lib/system/notificationPreferenceService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createNotificationPreferencesUpdateHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user, body }) => {
    try {
      const result = await updateNotificationPreferences({
        actorUserId: user.id,
        targetUserId: body.userId ?? user.id,
        preferences: {
          ...body.preferences,
          userId: body.userId ?? user.id,
        },
      }, {
        repository: options.preferenceRepository ?? createNotificationPreferenceRepository(options),
        emitEvent: false,
      })
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'notification-preferences-update', status: result.status }),
        result,
        emailDeliveryConfigured: false,
        webhookDeliveryConfigured: false,
        secretsStored: false,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
      }
    } catch (error) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message, {
        statusCode: error.statusCode ?? 400,
        publicMessage: error.statusCode === 403 ? 'notification preference update denied' : 'notification preferences are invalid',
      })
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'dashboard.read',
    routeId: 'notification-preferences-update',
    ...options,
  })
}

export const handler = createNotificationPreferencesUpdateHandler()
