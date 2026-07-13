import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimePreparedTradeRepository, prepareRealtimePaperTrades } from '../../lib/trading/realTimePaperTradePreparationCoordinator.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertPreparedTradeAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time prepared trade access denied', { statusCode: 403, publicMessage: 'real-time prepared trade access denied' })
}

export function createRealtimePreparedTradesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertPreparedTradeAccess(membership, event.httpMethod)
    const repository = options.realtimePreparedTradeRepository ?? createRealtimePreparedTradeRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.preparedTrade, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-prepared-trades', status: persistence.ok ? 'prepared' : 'blocked' }), preparedTrade: persistence.preparedTrade, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existingPreparedTrades = await repository.list?.({ tenantContext, preparationStatus: query.preparationStatus, symbol: query.symbol, limit: query.limit }) ?? []
    const realtimePreparedTrades = prepareRealtimePaperTrades({
      tenantContext,
      realtimePaperDecisions: options.realtimePaperDecisions,
      existingPreparedTrades,
      portfolio: options.portfolio,
      portfolioRisk: options.portfolioRisk,
      positionSizing: options.positionSizing,
      capitalAllocation: options.capitalAllocation,
      drawdownProtection: options.drawdownProtection,
      tradeGuardrail: options.tradeGuardrail,
      quote: options.quote,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-prepared-trades', status: realtimePreparedTrades.preparationStatus }), realtimePreparedTrades, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-prepared-trades', ...options })
}

export const handler = createRealtimePreparedTradesHandler()
