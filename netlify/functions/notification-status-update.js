import { updateInAppNotificationStatus } from '../../lib/system/inAppNotificationService.js'
import { sanitizeId } from './_shared/persistenceApi.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createNotificationStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, tenantContext, user }) => {
    const update = await updateInAppNotificationStatus({
      id: sanitizeId(body.id, 'notification id'),
      status: body.status,
      tenantContext,
      userId: user.id,
    }, {
      ...options,
      emitEvent: false,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'notification-status-update', status: update.status }),
      update,
      sensitiveMaterialExcluded: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'notification-status-update',
    ...options,
  })
}

export const handler = createNotificationStatusUpdateHandler()
