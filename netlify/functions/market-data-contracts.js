import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMarketDataContractRepository, normalizeMarketDataContracts } from '../../lib/market/marketDataContractEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertMarketDataAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Market data contract access denied', { statusCode: 403, publicMessage: 'Market data contract access denied' })
}

export function createMarketDataContractsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertMarketDataAccess(membership)
    const repository = options.marketDataContractRepository ?? createMarketDataContractRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.contract, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-contracts', status: persistence.ok ? 'normalized' : 'blocked' }), contract: persistence.contract, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, contractStatus: query.contractStatus, limit: query.limit }) ?? []
    const marketDataContracts = normalizeMarketDataContracts({ tenantContext, marketDataContracts: existing, marketDataAdapterHealth: options.marketDataAdapterHealth, scannerSignal: options.scannerSignal, historicalReplay: options.historicalReplay }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'market-data-contracts', status: marketDataContracts.marketDataContractStatus }), marketDataContracts, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'market-data-contracts', ...options })
}

export const handler = createMarketDataContractsHandler()
