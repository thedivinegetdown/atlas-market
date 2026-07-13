import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimeAlertRepository, createRealtimeAlerts } from '../../lib/alerts/realTimeAlertPipeline.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAlertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time alert access denied', { statusCode: 403, publicMessage: 'real-time alert access denied' })
}

export function createRealtimeAlertsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAlertAccess(membership, event.httpMethod)
    const repository = options.realtimeAlertRepository ?? createRealtimeAlertRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.alert, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-alerts', status: persistence.ok ? 'created' : 'blocked' }), alert: persistence.alert, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existingAlerts = await repository.list?.({ tenantContext, lifecycle: query.lifecycle, symbol: query.symbol, limit: query.limit }) ?? []
    const realtimeAlerts = createRealtimeAlerts({
      tenantContext,
      realtimeSignals: options.realtimeSignals,
      existingAlerts,
      notificationPreferences: options.notificationPreferences,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-alerts', status: realtimeAlerts.alertPipelineStatus }), realtimeAlerts, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-alerts', ...options })
}

export const handler = createRealtimeAlertsHandler()
