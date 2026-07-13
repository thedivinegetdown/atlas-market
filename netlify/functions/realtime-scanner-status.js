import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimeScannerRepository, evaluateRealtimeScanner } from '../../lib/scanners/realTimeScannerOrchestrator.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertRealtimeAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time scanner access denied', { statusCode: 403, publicMessage: 'real-time scanner access denied' })
}

export function createRealtimeScannerStatusHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertRealtimeAccess(membership, event.httpMethod)
    const repository = options.realtimeScannerRepository ?? createRealtimeScannerRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.subscription, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-scanner-status', status: persistence.ok ? 'active' : 'blocked' }), subscription: persistence.subscription, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const scannerSubscriptions = await repository.list?.({ tenantContext, limit: query.limit }) ?? []
    const realtimeScanner = evaluateRealtimeScanner({
      tenantContext,
      scannerSubscriptions,
      marketDataStreamingRouting: options.marketDataStreamingRouting,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-scanner-status', status: realtimeScanner.scannerStatus }), realtimeScanner, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-scanner-status', ...options })
}

export const handler = createRealtimeScannerStatusHandler()
