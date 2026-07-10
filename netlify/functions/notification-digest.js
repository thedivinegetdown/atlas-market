import { createInAppNotificationRepository } from '../../lib/system/inAppNotificationService.js'
import { createNotificationPreferenceRepository } from '../../lib/system/notificationPreferenceService.js'
import { createNotificationDigestRepository, generateNotificationDigest } from '../../lib/system/notificationDigestEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createNotificationDigestHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, tenantContext, user }) => {
    const notificationRepository = options.notificationRepository ?? createInAppNotificationRepository(options)
    const preferenceRepository = options.preferenceRepository ?? createNotificationPreferenceRepository(options)
    const digestRepository = options.digestRepository ?? createNotificationDigestRepository(options)
    const preferences = await preferenceRepository.getPreferences?.(user.id)
    const notifications = options.notifications ?? await notificationRepository.list?.({ tenantContext, userId: user.id, limit: query.limit }) ?? []
    const digest = await generateNotificationDigest({
      tenantContext,
      userId: user.id,
      notifications,
      preferences,
      frequency: query.frequency,
    }, {
      repository: digestRepository,
      emitEvent: false,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'notification-digest', status: digest.status }),
      digest,
      externalDelivery: false,
      sensitiveMaterialExcluded: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'notification-digest',
    ...options,
  })
}

export const handler = createNotificationDigestHandler()
