import { streamRealtimePaperPortfolio } from '../../lib/trading/realTimePortfolioStreamingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createRealtimePaperPortfolioHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, tenantContext, query }) => {
    const realtimePaperPortfolio = streamRealtimePaperPortfolio({
      tenantContext,
      accountId: query.accountId ?? options.accountId ?? 'paper-portfolio',
      realtimePortfolioReconciliation: options.realtimePortfolioReconciliation,
      portfolioAnalytics: options.portfolioAnalytics,
      portfolioRisk: options.portfolioRisk,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-portfolio', status: realtimePaperPortfolio.streamingPortfolioStatus }), realtimePaperPortfolio, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-paper-portfolio', ...options })
}

export const handler = createRealtimePaperPortfolioHandler()
