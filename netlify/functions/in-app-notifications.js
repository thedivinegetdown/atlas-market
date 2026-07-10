import { createInAppNotification, createInAppNotificationRepository, evaluateNotificationPreference } from '../../lib/system/inAppNotificationService.js'
import { createNotificationPreferenceRepository } from '../../lib/system/notificationPreferenceService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createInAppNotificationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, tenantContext, user, repository, event }) => {
    const notificationRepository = options.notificationRepository ?? createInAppNotificationRepository(options)
    const preferenceRepository = options.preferenceRepository ?? createNotificationPreferenceRepository(options)
    const preferences = await preferenceRepository.getPreferences?.(user.id)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const created = await createInAppNotification({
        notification: {
          ...body.notification,
          tenantContext,
          userId: user.id,
          sourceEventReference: body.notification?.sourceEventReference ?? body.sourceEventReference,
          operatorActionReference: body.notification?.operatorActionReference ?? body.operatorActionReference,
        },
        preferences,
      }, {
        repository: notificationRepository,
        emitEvent: false,
      })
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'in-app-notifications', status: created.status }),
        notification: created.normalizedNotificationModel,
        preferenceApplied: true,
        quietHoursApplied: created.quietHoursApplied,
        criticalSecurityVisible: created.criticalSecurityVisible,
        externalDelivery: false,
        sensitiveMaterialExcluded: true,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
      }
    }
    const notifications = await notificationRepository.list?.({ tenantContext, userId: user.id, status: query.status, limit: query.limit }) ?? []
    const visibleNotifications = notifications.filter((notification) => evaluateNotificationPreference(notification, preferences).visible || notification.severity === 'critical')
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'in-app-notifications' }),
      notifications: visibleNotifications,
      pagination: { limit: Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50)), returned: visibleNotifications.length },
      preferenceApplied: true,
      externalDelivery: false,
      sensitiveMaterialExcluded: true,
      repositoryConnected: repository.connected === true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'in-app-notifications',
    ...options,
  })
}

export const handler = createInAppNotificationsHandler()
