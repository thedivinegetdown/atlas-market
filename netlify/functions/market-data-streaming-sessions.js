import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataStreamingSessionRepository, evaluateMarketDataStreamingSession } from '../../lib/market/marketDataStreamingSessionEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertMarketDataAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data streaming session access denied', { statusCode: 403, publicMessage: 'Market data streaming session access denied' })
}

export function createMarketDataStreamingSessionsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertMarketDataAccess(membership)
    const repository = options.marketDataStreamingSessionRepository ?? createMarketDataStreamingSessionRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.session, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-streaming-sessions', status: persistence.ok ? 'evaluated' : 'blocked' }), session: persistence.session, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, sessionStatus: query.sessionStatus, limit: query.limit }) ?? []
    const marketDataStreamingSession = evaluateMarketDataStreamingSession({ tenantContext, marketDataStreamingSessions: existing, marketDataStreaming: options.marketDataStreaming, marketDataProviderFailover: options.marketDataProviderFailover }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-streaming-sessions', status: marketDataStreamingSession.marketDataStreamingSessionStatus }), marketDataStreamingSession, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'market-data-streaming-sessions', ...options })
}

export const handler = createMarketDataStreamingSessionsHandler()
