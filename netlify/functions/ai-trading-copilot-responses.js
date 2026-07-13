import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiTradingCopilotResponseRepository, prepareAiTradingCopilotResponse } from '../../lib/system/aiTradingCopilotResponseEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertTradingDeskAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI trading copilot response access denied', { statusCode: 403, publicMessage: 'AI trading copilot response access denied' })
}

export function createAiTradingCopilotResponsesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertTradingDeskAccess(membership)
    const repository = options.aiTradingCopilotResponseRepository ?? createAiTradingCopilotResponseRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.response, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-responses', status: persistence.ok ? 'prepared' : 'blocked' }), response: persistence.response, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, responseStatus: query.responseStatus, limit: query.limit }) ?? []
    const aiTradingCopilotResponse = prepareAiTradingCopilotResponse({ tenantContext, aiTradingCopilotResponses: existing, aiTradingCopilotContext: options.aiTradingCopilotContext, aiDecisionGovernanceReadiness: options.aiDecisionGovernanceReadiness, operatorActionCenter: options.operatorActionCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-responses', status: aiTradingCopilotResponse.aiTradingCopilotResponseStatus }), aiTradingCopilotResponse, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'ai-trading-copilot-responses', ...options })
}

export const handler = createAiTradingCopilotResponsesHandler()
