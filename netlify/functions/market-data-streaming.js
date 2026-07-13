import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataStreamingRepository, prepareMarketDataStreaming } from '../../lib/market/marketDataStreamingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertMarketDataAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data streaming access denied', { statusCode: 403, publicMessage: 'Market data streaming access denied' })
}

export function createMarketDataStreamingHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertMarketDataAccess(membership)
    const repository = options.marketDataStreamingRepository ?? createMarketDataStreamingRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.streaming, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-streaming', status: persistence.ok ? 'prepared' : 'blocked' }), streaming: persistence.streaming, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, streamingStatus: query.streamingStatus, limit: query.limit }) ?? []
    const marketDataStreaming = prepareMarketDataStreaming({ tenantContext, marketDataStreamingConfigs: existing, marketDataContracts: options.marketDataContracts, marketDataAdapterHealth: options.marketDataAdapterHealth }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-streaming', status: marketDataStreaming.marketDataStreamingStatus }), marketDataStreaming, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'market-data-streaming', ...options })
}

export const handler = createMarketDataStreamingHandler()
