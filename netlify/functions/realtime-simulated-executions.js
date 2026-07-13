import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimeSimulatedExecutionRepository, simulateRealtimePaperExecution } from '../../lib/trading/realTimeSimulatedExecutionCoordinator.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertSimulatedExecutionAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time simulated execution access denied', { statusCode: 403, publicMessage: 'real-time simulated execution access denied' })
}

export function createRealtimeSimulatedExecutionsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertSimulatedExecutionAccess(membership, event.httpMethod)
    const repository = options.realtimeSimulatedExecutionRepository ?? createRealtimeSimulatedExecutionRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.execution, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-simulated-executions', status: persistence.ok ? 'simulated' : 'blocked' }), execution: persistence.execution, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existingExecutions = await repository.list?.({ tenantContext, executionStatus: query.executionStatus, symbol: query.symbol, limit: query.limit }) ?? []
    const realtimeSimulatedExecutions = simulateRealtimePaperExecution({
      tenantContext,
      realtimePreparedTrades: options.realtimePreparedTrades,
      existingExecutions,
      portfolio: options.portfolio,
      quote: options.quote,
      realtimeAlerts: options.realtimeAlerts,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-simulated-executions', status: realtimeSimulatedExecutions.executionOperationsStatus }), realtimeSimulatedExecutions, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-simulated-executions', ...options })
}

export const handler = createRealtimeSimulatedExecutionsHandler()
