import { handler as equityCurveHandler } from '../../netlify/functions/equity-curve.js'
import { handler as alertsHandler } from '../../netlify/functions/alerts.js'
import { handler as createAlertHandler } from '../../netlify/functions/create-alert.js'
import { handler as createScannerHandler } from '../../netlify/functions/create-scanner.js'
import { handler as deleteAlertHandler } from '../../netlify/functions/delete-alert.js'
import { handler as deleteScannerHandler } from '../../netlify/functions/delete-scanner.js'
import { handler as decisionHandler } from '../../netlify/functions/decision.js'
import { handler as evaluateAlertsHandler } from '../../netlify/functions/evaluate-alerts.js'
import { handler as evaluateScannersHandler } from '../../netlify/functions/evaluate-scanners.js'
import { handler as healthHandler } from '../../netlify/functions/health.js'
import { handler as journalSummaryHandler } from '../../netlify/functions/journal-summary.js'
import { handler as marketOverviewHandler } from '../../netlify/functions/market-overview.js'
import { handler as ordersHandler } from '../../netlify/functions/orders.js'
import { handler as portfolioSummaryHandler } from '../../netlify/functions/portfolio-summary.js'
import { handler as positionsHandler } from '../../netlify/functions/positions.js'
import { handler as recalculatePortfolioHandler } from '../../netlify/functions/recalculate-portfolio.js'
import { handler as riskSummaryHandler } from '../../netlify/functions/risk-summary.js'
import { handler as scannersHandler } from '../../netlify/functions/scanners.js'
import { handler as signalsHandler } from '../../netlify/functions/signals.js'
import { handler as submitPaperOrderHandler } from '../../netlify/functions/submit-paper-order.js'
import { handler as cancelPaperOrderHandler } from '../../netlify/functions/cancel-paper-order.js'
import { handler as watchlistHandler } from '../../netlify/functions/watchlist.js'
import { handler as updateAlertHandler } from '../../netlify/functions/update-alert.js'
import { handler as updateScannerHandler } from '../../netlify/functions/update-scanner.js'

const handlers = {
  alerts: alertsHandler,
  'cancel-paper-order': cancelPaperOrderHandler,
  'create-alert': createAlertHandler,
  'create-scanner': createScannerHandler,
  'delete-alert': deleteAlertHandler,
  'delete-scanner': deleteScannerHandler,
  decision: decisionHandler,
  'equity-curve': equityCurveHandler,
  'evaluate-alerts': evaluateAlertsHandler,
  'evaluate-scanners': evaluateScannersHandler,
  health: healthHandler,
  'journal-summary': journalSummaryHandler,
  'market-overview': marketOverviewHandler,
  orders: ordersHandler,
  'portfolio-summary': portfolioSummaryHandler,
  positions: positionsHandler,
  'recalculate-portfolio': recalculatePortfolioHandler,
  'risk-summary': riskSummaryHandler,
  scanners: scannersHandler,
  signals: signalsHandler,
  'submit-paper-order': submitPaperOrderHandler,
  'update-alert': updateAlertHandler,
  'update-scanner': updateScannerHandler,
  watchlist: watchlistHandler,
}

const originalFetch = globalThis.fetch

globalThis.fetch = async (input, init) => {
  const requestUrl = typeof input === 'string' ? input : input?.url
  const url = new URL(requestUrl, 'http://localhost')
  const prefix = '/.netlify/functions/'

  if (!url.pathname.startsWith(prefix)) {
    if (typeof originalFetch === 'function') {
      return originalFetch(input, init)
    }
    throw new Error(`Unhandled fetch request: ${requestUrl}`)
  }

  const functionName = url.pathname.slice(prefix.length)
  const handler = handlers[functionName]

  if (!handler) {
    throw new Error(`No test handler registered for ${functionName}`)
  }

  const queryStringParameters = Object.fromEntries(url.searchParams.entries())
  const response = await handler({
    queryStringParameters,
    httpMethod: init?.method ?? 'GET',
    body: init?.body ?? null,
    headers: functionName === 'market-overview'
      ? { authorization: 'Bearer test-session', ...(init?.headers ?? {}) }
      : (init?.headers ?? {}),
  })

  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    headers: response.headers,
    async json() {
      return JSON.parse(response.body)
    },
  }
}
