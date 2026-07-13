import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataStreamingEventRoutingRepository, routeMarketDataStreamingEvents } from '../../lib/market/marketDataStreamingEventRouter.js'
import { createMockWebSocketProviderAdapter } from '../../lib/market/marketDataStreamingProviderAdapters.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertRoutingAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data streaming routing access denied', { statusCode: 403, publicMessage: 'Market data streaming routing access denied' })
}

export function createMarketDataStreamingRoutingHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertRoutingAccess(membership, event.httpMethod)
    const repository = options.marketDataStreamingEventRoutingRepository ?? createMarketDataStreamingEventRoutingRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.route, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-streaming-routing-health', status: persistence.ok ? 'routed' : 'blocked' }), route: persistence.route, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, routingStatus: query.routingStatus, limit: query.limit }) ?? []
    const mock = createMockWebSocketProviderAdapter({ timestamp: '2026-07-13T10:24:00.000Z' })
    const marketDataStreamingRouting = routeMarketDataStreamingEvents({
      tenantContext,
      routes: existing,
      providerEvents: existing.length ? [] : mock.simulateEvents({ channel: 'quote' }),
    }, { emitEvent: false, timestamp: '2026-07-13T10:25:00.000Z' })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-streaming-routing-health', status: marketDataStreamingRouting.marketDataStreamingRoutingStatus }), marketDataStreamingRouting, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'market-data-streaming-routing-health', ...options })
}

export const handler = createMarketDataStreamingRoutingHealthHandler()
