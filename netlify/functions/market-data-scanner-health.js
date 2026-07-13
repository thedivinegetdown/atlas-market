import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataScannerHealthRepository, evaluateMarketDataScannerHealth } from '../../lib/market/marketDataScannerHealthEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data scanner health access denied', { statusCode: 403, publicMessage: 'market data scanner health access denied' })
}

export function createMarketDataScannerHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.marketDataScannerHealthRepository ?? createMarketDataScannerHealthRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = evaluateMarketDataScannerHealth({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.marketDataScannerHealthSnapshot)
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-scanner-health', status: result.healthStatus }), marketDataScannerHealth: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const snapshots = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, healthStatus: query.healthStatus, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-scanner-health', status: 'ok' }), marketDataScannerHealth: snapshots, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'market-data-scanner-health', ...options })
}

export const handler = createMarketDataScannerHealthHandler()
