import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataCacheRepository, prepareMarketDataCache } from '../../lib/market/marketDataCacheEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertMarketDataAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data cache access denied', { statusCode: 403, publicMessage: 'Market data cache access denied' })
}

export function createMarketDataCacheHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertMarketDataAccess(membership)
    const repository = options.marketDataCacheRepository ?? createMarketDataCacheRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.cache, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-cache', status: persistence.ok ? 'prepared' : 'blocked' }), cache: persistence.cache, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, cacheStatus: query.cacheStatus, limit: query.limit }) ?? []
    const marketDataCache = prepareMarketDataCache({ tenantContext, marketDataCaches: existing, marketDataContracts: options.marketDataContracts, cachePolicy: options.cachePolicy }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-cache', status: marketDataCache.marketDataCacheStatus }), marketDataCache, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'market-data-cache', ...options })
}

export const handler = createMarketDataCacheHandler()
