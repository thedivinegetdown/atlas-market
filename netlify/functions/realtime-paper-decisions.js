import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimePaperDecisionRepository, evaluateRealtimePaperDecisions } from '../../lib/trading/realTimePaperDecisionCoordinator.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertPaperDecisionAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time paper decision access denied', { statusCode: 403, publicMessage: 'real-time paper decision access denied' })
}

export function createRealtimePaperDecisionsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertPaperDecisionAccess(membership, event.httpMethod)
    const repository = options.realtimePaperDecisionRepository ?? createRealtimePaperDecisionRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.decision, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-decisions', status: persistence.ok ? 'evaluated' : 'blocked' }), decision: persistence.decision, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existingDecisions = await repository.list?.({ tenantContext, decisionStatus: query.decisionStatus, symbol: query.symbol, limit: query.limit }) ?? []
    const realtimePaperDecisions = evaluateRealtimePaperDecisions({
      tenantContext,
      realtimeSignals: options.realtimeSignals,
      realtimeAlerts: options.realtimeAlerts,
      existingDecisions,
      researchEnhancedDecision: options.researchEnhancedDecision,
      marketRegimeClassification: options.marketRegimeClassification,
      portfolioRisk: options.portfolioRisk,
      drawdownProtection: options.drawdownProtection,
      capitalAllocation: options.capitalAllocation,
      strategyLifecycle: options.strategyLifecycle,
      strategyRegistry: options.strategyRegistry,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-decisions', status: realtimePaperDecisions.decisionEvaluationStatus }), realtimePaperDecisions, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-paper-decisions', ...options })
}

export const handler = createRealtimePaperDecisionsHandler()
