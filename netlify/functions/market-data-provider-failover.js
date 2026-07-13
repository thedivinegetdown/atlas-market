import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataProviderFailoverRepository, evaluateMarketDataProviderFailover } from '../../lib/market/marketDataProviderFailoverEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertMarketDataAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data provider failover access denied', { statusCode: 403, publicMessage: 'Market data provider failover access denied' })
}

export function createMarketDataProviderFailoverHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertMarketDataAccess(membership)
    const repository = options.marketDataProviderFailoverRepository ?? createMarketDataProviderFailoverRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.failover, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-provider-failover', status: persistence.ok ? 'evaluated' : 'blocked' }), failover: persistence.failover, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, failoverStatus: query.failoverStatus, limit: query.limit }) ?? []
    const marketDataProviderFailover = evaluateMarketDataProviderFailover({ tenantContext, marketDataProviderFailovers: existing, marketDataAdapterHealth: options.marketDataAdapterHealth, marketDataCache: options.marketDataCache, marketDataStreaming: options.marketDataStreaming }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-provider-failover', status: marketDataProviderFailover.marketDataProviderFailoverStatus }), marketDataProviderFailover, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'market-data-provider-failover', ...options })
}

export const handler = createMarketDataProviderFailoverHandler()
