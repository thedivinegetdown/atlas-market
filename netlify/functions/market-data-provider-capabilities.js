import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataWebSocketAdapterRepository, evaluateMarketDataWebSocketAdapter } from '../../lib/market/marketDataWebSocketAdapterEngine.js'
import { buildDefaultStreamingProviderAdapters } from '../../lib/market/marketDataStreamingProviderAdapters.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertProviderAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data provider capabilities access denied', { statusCode: 403, publicMessage: 'Market data provider capabilities access denied' })
}

export function createMarketDataProviderCapabilitiesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertProviderAccess(membership, event.httpMethod)
    const repository = options.marketDataWebSocketAdapterRepository ?? createMarketDataWebSocketAdapterRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.adapter, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-provider-capabilities', status: persistence.ok ? 'evaluated' : 'blocked' }), adapter: persistence.adapter, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, adapterStatus: query.adapterStatus, limit: query.limit }) ?? []
    const adapters = existing.length ? existing : buildDefaultStreamingProviderAdapters({ env: options.env ?? process.env }).map((adapter) => ({ capabilityMetadata: adapter.metadata, adapterStatus: adapter.metadata.configured ? 'ready' : 'caution', adapterScore: adapter.metadata.configured ? 92 : 70, tenantContext }))
    const marketDataWebSocketAdapter = evaluateMarketDataWebSocketAdapter({ tenantContext, marketDataWebSocketAdapters: adapters }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-provider-capabilities', status: marketDataWebSocketAdapter.marketDataWebSocketAdapterStatus }), marketDataWebSocketAdapter, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'market-data-provider-capabilities', ...options })
}

export const handler = createMarketDataProviderCapabilitiesHandler()
