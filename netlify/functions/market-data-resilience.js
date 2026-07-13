import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataProviderResilienceRepository, evaluateMarketDataProviderResilience } from '../../lib/market/marketDataProviderResilienceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data resilience access denied', { statusCode: 403, publicMessage: 'market data resilience access denied' })
}

export function createMarketDataResilienceHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.marketDataProviderResilienceRepository ?? createMarketDataProviderResilienceRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = evaluateMarketDataProviderResilience({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.marketDataProviderResilienceSnapshot)
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-resilience', status: result.healthStatus }), marketDataProviderResilience: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const snapshots = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, healthStatus: query.healthStatus, providerId: query.providerId, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-resilience', status: 'ok' }), marketDataProviderResilience: snapshots, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'market-data-resilience', ...options })
}

export const handler = createMarketDataResilienceHandler()
