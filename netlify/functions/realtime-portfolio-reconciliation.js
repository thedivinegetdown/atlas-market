import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimePortfolioReconciliationRepository, reconcileRealtimePortfolio } from '../../lib/trading/realTimePortfolioReconciliationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertReconciliationAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time portfolio reconciliation access denied', { statusCode: 403, publicMessage: 'real-time portfolio reconciliation access denied' })
}

export function createRealtimePortfolioReconciliationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertReconciliationAccess(membership, event.httpMethod)
    const repository = options.realtimePortfolioReconciliationRepository ?? createRealtimePortfolioReconciliationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const reconciliation = reconcileRealtimePortfolio({
        tenantContext,
        accountId: body.accountId ?? options.accountId ?? 'paper-portfolio',
        realtimeSimulatedExecutions: body.realtimeSimulatedExecutions ?? options.realtimeSimulatedExecutions,
        expectedAccountState: body.expectedAccountState,
        expectedPositions: body.expectedPositions,
      }, { emitEvent: false })
      const saved = await Promise.all(reconciliation.realtimePortfolioReconciliations.map((item) => repository.create(item)))
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-portfolio-reconciliation', status: reconciliation.reconciliationStatus }), realtimePortfolioReconciliation: { ...reconciliation, persisted: saved.length }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existingReconciliations = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, reconciliationStatus: query.reconciliationStatus, limit: query.limit }) ?? []
    const realtimePortfolioReconciliation = reconcileRealtimePortfolio({
      tenantContext,
      accountId: query.accountId ?? options.accountId ?? 'paper-portfolio',
      realtimeSimulatedExecutions: options.realtimeSimulatedExecutions,
      existingReconciliations,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-portfolio-reconciliation', status: realtimePortfolioReconciliation.reconciliationStatus }), realtimePortfolioReconciliation, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-portfolio-reconciliation', ...options })
}

export const handler = createRealtimePortfolioReconciliationHandler()
