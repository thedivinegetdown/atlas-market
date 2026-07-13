import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiTradingCopilotContextRepository, prepareAiTradingCopilotContext } from '../../lib/system/aiTradingCopilotContextEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertTradingDeskAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI trading copilot access denied', { statusCode: 403, publicMessage: 'AI trading copilot access denied' })
}

export function createAiTradingCopilotContextsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertTradingDeskAccess(membership)
    const repository = options.aiTradingCopilotContextRepository ?? createAiTradingCopilotContextRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.context, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-contexts', status: response.ok ? 'prepared' : 'blocked' }), context: response.context, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, contextStatus: query.contextStatus, limit: query.limit }) ?? []
    const aiTradingCopilotContext = prepareAiTradingCopilotContext({ tenantContext, aiTradingCopilotContexts: existing, aiDecision: options.aiDecision, researchEnhancedDecision: options.researchEnhancedDecision, marketIntelligence: options.marketIntelligence, risk: options.risk, portfolioAnalytics: options.portfolioAnalytics, aiDecisionExplainability: options.aiDecisionExplainability }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-contexts', status: aiTradingCopilotContext.aiTradingCopilotContextStatus }), aiTradingCopilotContext, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'ai-trading-copilot-contexts', ...options })
}

export const handler = createAiTradingCopilotContextsHandler()
