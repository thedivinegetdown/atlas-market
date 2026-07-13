import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateMarketDataWebSocketAdapter } from '../../lib/market/marketDataWebSocketAdapterEngine.js'
import { buildDefaultStreamingProviderAdapters } from '../../lib/market/marketDataStreamingProviderAdapters.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertProviderHealthAccess(membership) {
  if (!['owner', 'admin', 'analyst', 'viewer'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data provider adapter health access denied', { statusCode: 403, publicMessage: 'Market data provider adapter health access denied' })
}

export function createMarketDataProviderAdapterHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertProviderHealthAccess(membership)
    const adapters = buildDefaultStreamingProviderAdapters({ env: options.env ?? process.env }).map((adapter) => ({
      tenantContext,
      capabilityMetadata: adapter.metadata,
      adapterStatus: adapter.metadata.configured ? 'ready' : 'caution',
      adapterScore: adapter.metadata.configured ? 92 : 70,
      lifecycleState: { initialized: true, connected: adapter.metadata.mockMode, heartbeatHealthy: true },
    }))
    const marketDataWebSocketAdapter = evaluateMarketDataWebSocketAdapter({ tenantContext, marketDataWebSocketAdapters: adapters }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-provider-adapter-health', status: marketDataWebSocketAdapter.marketDataWebSocketAdapterStatus }), marketDataWebSocketAdapter, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'market-data-provider-adapter-health', ...options })
}

export const handler = createMarketDataProviderAdapterHealthHandler()
