import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createScannerThroughputRepository, evaluateScannerThroughputBackpressure } from '../../lib/scanners/scannerThroughputBackpressureEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Scanner production health access denied', { statusCode: 403, publicMessage: 'scanner production health access denied' })
}

export function createScannerProductionHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.scannerThroughputRepository ?? createScannerThroughputRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = evaluateScannerThroughputBackpressure({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.scannerThroughputSnapshot)
      return { event: apiFoundationEvent({ requestId, endpoint: 'scanner-production-health', status: result.cycleStatus }), scannerProductionHealth: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const snapshots = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, cycleStatus: query.cycleStatus, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'scanner-production-health', status: 'ok' }), scannerProductionHealth: snapshots, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'scanner-production-health', ...options })
}

export const handler = createScannerProductionHealthHandler()
