import { createApiHandler } from './_shared/api.js'
import { tradingEventLogger, TRADING_EVENTS } from '../../lib/observability/eventLogger.js'

export const handler = createApiHandler(async ({ service, requestId }) => {
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
}, { allowedMethods: ['POST'] })
