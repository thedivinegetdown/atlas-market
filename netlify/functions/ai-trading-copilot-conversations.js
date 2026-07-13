import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiTradingCopilotConversationRepository, prepareAiTradingCopilotConversation } from '../../lib/system/aiTradingCopilotConversationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertTradingDeskAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI trading copilot conversation access denied', { statusCode: 403, publicMessage: 'AI trading copilot conversation access denied' })
}

export function createAiTradingCopilotConversationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertTradingDeskAccess(membership)
    const repository = options.aiTradingCopilotConversationRepository ?? createAiTradingCopilotConversationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.conversation, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-conversations', status: persistence.ok ? 'prepared' : 'blocked' }), conversation: persistence.conversation, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, conversationStatus: query.conversationStatus, limit: query.limit }) ?? []
    const aiTradingCopilotConversation = prepareAiTradingCopilotConversation({ tenantContext, aiTradingCopilotConversations: existing, aiTradingCopilotPortfolioInsight: options.aiTradingCopilotPortfolioInsight, aiTradingCopilotTradeSignalExplanation: options.aiTradingCopilotTradeSignalExplanation, marketIntelligence: options.marketIntelligence, researchEnhancedDecision: options.researchEnhancedDecision, portfolioAnalytics: options.portfolioAnalytics, portfolioRisk: options.portfolioRisk }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-conversations', status: aiTradingCopilotConversation.aiTradingCopilotConversationStatus }), aiTradingCopilotConversation, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'ai-trading-copilot-conversations', ...options })
}

export const handler = createAiTradingCopilotConversationsHandler()
