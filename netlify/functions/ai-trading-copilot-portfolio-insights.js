import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiTradingCopilotPortfolioInsightRepository, generateAiTradingCopilotPortfolioInsights } from '../../lib/system/aiTradingCopilotPortfolioInsightEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertTradingDeskAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI trading copilot portfolio insight access denied', { statusCode: 403, publicMessage: 'AI trading copilot portfolio insight access denied' })
}

export function createAiTradingCopilotPortfolioInsightsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertTradingDeskAccess(membership)
    const repository = options.aiTradingCopilotPortfolioInsightRepository ?? createAiTradingCopilotPortfolioInsightRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.insight, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-portfolio-insights', status: persistence.ok ? 'generated' : 'blocked' }), insight: persistence.insight, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, insightStatus: query.insightStatus, limit: query.limit }) ?? []
    const aiTradingCopilotPortfolioInsight = generateAiTradingCopilotPortfolioInsights({ tenantContext, aiTradingCopilotPortfolioInsights: existing, strategySignalComposition: options.strategySignalComposition, strategyAttribution: options.strategyAttribution, strategyBacktestPerformance: options.strategyBacktestPerformance, portfolioAnalytics: options.portfolioAnalytics, portfolioOptimization: options.portfolioOptimization, portfolioRisk: options.portfolioRisk, aiTradingCopilotTradeSignalExplanation: options.aiTradingCopilotTradeSignalExplanation }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-portfolio-insights', status: aiTradingCopilotPortfolioInsight.aiTradingCopilotPortfolioInsightStatus }), aiTradingCopilotPortfolioInsight, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'ai-trading-copilot-portfolio-insights', ...options })
}

export const handler = createAiTradingCopilotPortfolioInsightsHandler()
