import { createInAppNotificationRepository } from '../../lib/system/inAppNotificationService.js'
import { createNotificationPreferenceRepository } from '../../lib/system/notificationPreferenceService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createNotificationCenterHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, tenantContext, user }) => {
    const notificationRepository = options.notificationRepository ?? createInAppNotificationRepository(options)
    const preferenceRepository = options.preferenceRepository ?? createNotificationPreferenceRepository(options)
    const preferences = await preferenceRepository.getPreferences?.(user.id)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'notification-center-health' }),
      health: {
        status: 'healthy',
        tenantScoped: Boolean(tenantContext.organizationId),
        userScoped: user.id === tenantContext.userId,
        inAppFunctional: true,
        preferenceOwnershipPreserved: preferences.userId === user.id,
        externalEmailProviderConfigured: false,
        externalWebhookProviderConfigured: false,
        repositoryConnected: notificationRepository.connected === true,
      },
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'notification-center-health',
    ...options,
  })
}

export const handler = createNotificationCenterHealthHandler()
