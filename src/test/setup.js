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
import { handler as strategySuitabilityHandler } from '../../netlify/functions/strategy-suitability.js'
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
import { handler as csrfTokenHandler } from '../../netlify/functions/csrf-token.js'

const handlers = {
  alerts: alertsHandler,
  'cancel-paper-order': cancelPaperOrderHandler,
  'create-alert': createAlertHandler,
  'create-scanner': createScannerHandler,
  'csrf-token': csrfTokenHandler,
  'delete-alert': deleteAlertHandler,
  'delete-scanner': deleteScannerHandler,
  decision: decisionHandler,
  'equity-curve': equityCurveHandler,
  'evaluate-alerts': evaluateAlertsHandler,
  'evaluate-scanners': evaluateScannersHandler,
  health: healthHandler,
  'journal-summary': journalSummaryHandler,
  'market-overview': marketOverviewHandler,
  'strategy-suitability': strategySuitabilityHandler,
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
if (globalThis.document) globalThis.document.cookie = 'nf_jwt=dev-token; path=/'

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
  const method = init?.method ?? 'GET'
  const parsedBody = init?.body ? JSON.parse(init.body) : {}
  const compatibilityHandlers = {
    'paper-workspace-projection': url.searchParams.get('view') === 'journal' ? journalSummaryHandler : portfolioSummaryHandler,
    'alert-configurations': method === 'GET' ? alertsHandler : ({ create: createAlertHandler, update: updateAlertHandler, delete: deleteAlertHandler, evaluate: evaluateAlertsHandler })[parsedBody.action],
    'scanner-configurations': method === 'GET' ? scannersHandler : ({ create: createScannerHandler, update: updateScannerHandler, delete: deleteScannerHandler, evaluate: evaluateScannersHandler })[parsedBody.action],
  }
  const handler = handlers[functionName] ?? compatibilityHandlers[functionName]

  if (!handler) {
    throw new Error(`No test handler registered for ${functionName}`)
  }

  const queryStringParameters = Object.fromEntries(url.searchParams.entries())
  const response = await handler({
    queryStringParameters,
    httpMethod: method,
    body: functionName === 'alert-configurations'
      ? JSON.stringify(parsedBody.alert ?? parsedBody.context ?? { id: parsedBody.id })
      : functionName === 'scanner-configurations'
        ? JSON.stringify(parsedBody.scanner ?? { id: parsedBody.id })
        : init?.body ?? null,
    headers: ['market-overview', 'strategy-suitability'].includes(functionName)
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
