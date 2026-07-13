import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateMarketDataStreamingOperations } from '../../lib/market/marketDataStreamingOperationsEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertMarketDataAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data streaming operations access denied', { statusCode: 403, publicMessage: 'Market data streaming operations access denied' })
}

export function createMarketDataStreamingOperationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertMarketDataAccess(membership)
    const marketDataStreamingOperations = evaluateMarketDataStreamingOperations({
      tenantContext,
      marketDataStreamingSession: options.marketDataStreamingSession,
      marketDataProviderFailover: options.marketDataProviderFailover,
      marketDataStreaming: options.marketDataStreaming,
      marketDataGapRecovery: options.marketDataGapRecovery,
      marketDataCache: options.marketDataCache,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-streaming-operations', status: marketDataStreamingOperations.operationalStatus }), marketDataStreamingOperations, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'market-data-streaming-operations', ...options })
}

export const handler = createMarketDataStreamingOperationsHandler()
