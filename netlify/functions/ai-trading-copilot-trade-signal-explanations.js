import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiTradingCopilotTradeSignalExplanationRepository, explainAiTradingCopilotTradeSignal } from '../../lib/system/aiTradingCopilotTradeSignalExplanationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertTradingDeskAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI trading copilot trade signal explanation access denied', { statusCode: 403, publicMessage: 'AI trading copilot trade signal explanation access denied' })
}

export function createAiTradingCopilotTradeSignalExplanationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertTradingDeskAccess(membership)
    const repository = options.aiTradingCopilotTradeSignalExplanationRepository ?? createAiTradingCopilotTradeSignalExplanationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.explanation, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-trade-signal-explanations', status: persistence.ok ? 'explained' : 'blocked' }), explanation: persistence.explanation, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, explanationStatus: query.explanationStatus, limit: query.limit }) ?? []
    const aiTradingCopilotTradeSignalExplanation = explainAiTradingCopilotTradeSignal({ tenantContext, aiTradingCopilotTradeSignalExplanations: existing, aiDecision: options.aiDecision, strategySignalComposition: options.strategySignalComposition, aiTradingCopilotContext: options.aiTradingCopilotContext, aiTradingCopilotResponse: options.aiTradingCopilotResponse, tradeGuardrail: options.tradeGuardrail, positionSizing: options.positionSizing }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-trade-signal-explanations', status: aiTradingCopilotTradeSignalExplanation.aiTradingCopilotTradeSignalExplanationStatus }), aiTradingCopilotTradeSignalExplanation, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'ai-trading-copilot-trade-signal-explanations', ...options })
}

export const handler = createAiTradingCopilotTradeSignalExplanationsHandler()
