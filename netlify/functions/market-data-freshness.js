import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataFreshnessGapRecoveryRepository, evaluateMarketDataFreshnessGapRecovery } from '../../lib/market/marketDataFreshnessGapRecoveryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertMarketDataAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data freshness access denied', { statusCode: 403, publicMessage: 'Market data freshness access denied' })
}

export function createMarketDataFreshnessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertMarketDataAccess(membership)
    const repository = options.marketDataFreshnessGapRecoveryRepository ?? createMarketDataFreshnessGapRecoveryRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.recovery, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-freshness', status: persistence.ok ? 'evaluated' : 'blocked' }), recovery: persistence.recovery, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, recoveryStatus: query.recoveryStatus, limit: query.limit }) ?? []
    const marketDataGapRecovery = evaluateMarketDataFreshnessGapRecovery({ tenantContext, marketDataGapRecoveries: existing, marketDataCache: options.marketDataCache, historicalReplay: options.historicalReplay }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-freshness', status: marketDataGapRecovery.marketDataGapRecoveryStatus }), marketDataGapRecovery, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'market-data-freshness', ...options })
}

export const handler = createMarketDataFreshnessHandler()
