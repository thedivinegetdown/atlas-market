import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimePaperOperationsRepository, evaluateRealtimePaperOperations } from '../../lib/trading/realTimePaperOperationsCommandCenterEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOperationsAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time paper operations access denied', { statusCode: 403, publicMessage: 'real-time paper operations access denied' })
}

export function createRealtimePaperOperationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOperationsAccess(membership, event.httpMethod)
    const repository = options.realtimePaperOperationsRepository ?? createRealtimePaperOperationsRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const operations = evaluateRealtimePaperOperations({ ...options, ...body, tenantContext }, { emitEvent: false })
      const saved = await repository.create(operations)
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-operations', status: operations.operationsStatus }), realtimePaperOperations: { ...operations, persisted: saved.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, operationsStatus: query.operationsStatus, limit: query.limit }) ?? []
    const realtimePaperOperations = existing[0] ?? evaluateRealtimePaperOperations({ ...options, tenantContext }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-operations', status: realtimePaperOperations.operationsStatus }), realtimePaperOperations, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-paper-operations', ...options })
}

export const handler = createRealtimePaperOperationsHandler()
