import { evaluateUserActivityTimeline } from '../../lib/system/userActivityTimelineService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createCurrentUserActivityHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, tenantContext, user }) => {
    const timeline = evaluateUserActivityTimeline({
      tenantContext,
      requester: user,
      targetUserId: user.id,
      administrative: false,
      query,
      administrativeAuditRecords: options.administrativeAuditRecords,
      sessions: options.sessions,
      notifications: options.notifications,
      operatorActions: options.operatorActions,
      systemEvents: options.systemEvents,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'current-user-activity', status: timeline.status }),
      timeline,
      sensitiveFieldRedaction: timeline.sensitiveFieldRedaction,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'current-user-activity',
    ...options,
  })
}

export const handler = createCurrentUserActivityHandler()
