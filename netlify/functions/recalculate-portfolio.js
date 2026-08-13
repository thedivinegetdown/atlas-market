import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'
import { tradingEventLogger, TRADING_EVENTS } from '../../lib/observability/eventLogger.js'

export const handler = createProtectedWorkspaceApiHandler(async ({ service, requestId }) => {
  const [portfolio, equityCurve] = await Promise.all([
    service.getPortfolioSummary(),
    service.getEquityCurve(),
  ])
  tradingEventLogger.log(TRADING_EVENTS.PORTFOLIO_RECALCULATED, {
    requestId,
    accountValue: portfolio.summary.accountValue,
  })

  return {
    paperTrading: true,
    portfolio: portfolio.summary,
    equityCurve,
  }
}, { allowedMethods: ['POST'], mutation: true, routeId: 'recalculate-portfolio' })
