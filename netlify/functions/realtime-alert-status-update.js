import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimeAlertRepository, updateRealtimeAlertLifecycle } from '../../lib/alerts/realTimeAlertPipeline.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAlertUpdateAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time alert update access denied', { statusCode: 403, publicMessage: 'real-time alert update access denied' })
}

export function createRealtimeAlertStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertAlertUpdateAccess(membership)
    const repository = options.realtimeAlertRepository ?? createRealtimeAlertRepository(options)
    const persistence = await repository.updateStatus?.({ id: body.id ?? body.alertId, tenantContext, lifecycle: body.lifecycle ?? body.status })
    const realtimeAlertUpdate = updateRealtimeAlertLifecycle({
      id: body.id ?? body.alertId,
      tenantContext,
      lifecycle: body.lifecycle ?? body.status,
      alert: persistence?.alert,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-alert-status-update', status: realtimeAlertUpdate.alertPipelineStatus }), realtimeAlertUpdate, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-alert-status-update', ...options })
}

export const handler = createRealtimeAlertStatusUpdateHandler()
