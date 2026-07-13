import { streamRealtimePaperPortfolio } from '../../lib/trading/realTimePortfolioStreamingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createRealtimePnlHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, tenantContext, query }) => {
    const realtimePaperPortfolio = streamRealtimePaperPortfolio({
      tenantContext,
      accountId: query.accountId ?? options.accountId ?? 'paper-portfolio',
      realtimePortfolioReconciliation: options.realtimePortfolioReconciliation,
      portfolioAnalytics: options.portfolioAnalytics,
      portfolioRisk: options.portfolioRisk,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'realtime-pnl', status: realtimePaperPortfolio.streamingPortfolioStatus }),
      realtimePnl: {
        realizedPnlSummary: realtimePaperPortfolio.realizedPnlSummary,
        unrealizedPnlSummary: realtimePaperPortfolio.unrealizedPnlSummary,
        currentEquitySummary: realtimePaperPortfolio.currentEquitySummary,
        latestReconciliationStatus: realtimePaperPortfolio.latestReconciliationStatus,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
      },
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-pnl', ...options })
}

export const handler = createRealtimePnlHandler()
