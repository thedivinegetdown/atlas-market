import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateUserActivityTimeline } from '../../lib/system/userActivityTimelineService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'tenant administrative activity access denied', {
      statusCode: 403,
      publicMessage: 'tenant administrative activity access denied',
    })
  }
}

export function createTenantAdministrativeActivityHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext, user }) => {
    assertOwnerAdmin(membership)
    const timeline = evaluateUserActivityTimeline({
      tenantContext,
      requester: user,
      administrative: true,
      query,
      administrativeAuditRecords: options.administrativeAuditRecords,
      sessions: options.sessions,
      notifications: options.notifications,
      operatorActions: options.operatorActions,
      systemEvents: options.systemEvents,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'tenant-administrative-activity', status: timeline.status }),
      timeline,
      analystViewerTenantAdminDenied: true,
      sensitiveFieldRedaction: timeline.sensitiveFieldRedaction,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'tenant-administrative-activity',
    ...options,
  })
}

export const handler = createTenantAdministrativeActivityHandler()
