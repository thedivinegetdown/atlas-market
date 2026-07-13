import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimeSignalEvaluationRepository, evaluateRealtimeSignals } from '../../lib/signals/realTimeSignalEvaluationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertSignalAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time signal access denied', { statusCode: 403, publicMessage: 'real-time signal access denied' })
}

export function createRealtimeSignalEvaluationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertSignalAccess(membership, event.httpMethod)
    const repository = options.realtimeSignalEvaluationRepository ?? createRealtimeSignalEvaluationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.signal, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-signal-evaluations', status: persistence.ok ? 'evaluated' : 'blocked' }), signal: persistence.signal, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, signalStatus: query.signalStatus, symbol: query.symbol, limit: query.limit }) ?? []
    const realtimeSignals = evaluateRealtimeSignals({
      tenantContext,
      realtimeSignalEvaluations: existing,
      realtimeScanner: options.realtimeScanner,
      researchSignalScore: options.researchSignalScore,
      marketRegimeClassification: options.marketRegimeClassification,
      portfolioRisk: options.portfolioRisk,
      strategyRuleEvaluation: options.strategyRuleEvaluation,
      strategySignalComposition: options.strategySignalComposition,
      multiTimeframeResearchContext: options.multiTimeframeResearchContext,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-signal-evaluations', status: realtimeSignals.signalEvaluationStatus }), realtimeSignals, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-signal-evaluations', ...options })
}

export const handler = createRealtimeSignalEvaluationsHandler()
