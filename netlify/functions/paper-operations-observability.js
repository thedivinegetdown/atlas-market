import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperOperationsObservabilityRepository, evaluatePaperOperationsObservability } from '../../lib/trading/paperOperationsObservabilityEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper operations observability access denied', { statusCode: 403, publicMessage: 'paper operations observability access denied' })
}

export function createPaperOperationsObservabilityHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperOperationsObservabilityRepository ?? createPaperOperationsObservabilityRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = evaluatePaperOperationsObservability({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.paperOperationsObservabilitySnapshot)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-observability', status: result.healthStatus }), paperOperationsObservability: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const snapshots = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, healthStatus: query.healthStatus, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-observability', status: 'ok' }), paperOperationsObservability: snapshots, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-operations-observability', ...options })
}

export const handler = createPaperOperationsObservabilityHandler()
