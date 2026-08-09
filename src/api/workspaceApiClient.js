import { clientLogger } from '../utils/clientLogger.js'

const defaultBasePath = '/.netlify/functions'
const diagnosticListeners = new Set()
let diagnostics = {
  apiStatus: 'unknown',
  lastSuccessfulSync: null,
  lastError: null,
}

function emitDiagnostics(nextDiagnostics) {
  diagnostics = {
    ...diagnostics,
    ...nextDiagnostics,
  }
  for (const listener of diagnosticListeners) {
    listener(diagnostics)
  }
}

export const workspaceApiDiagnostics = {
  getSnapshot() {
    return diagnostics
  },
  subscribe(listener) {
    diagnosticListeners.add(listener)
    return () => diagnosticListeners.delete(listener)
  },
}

function buildUrl(path, params = {}) {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, value)
    }
  }

  const query = searchParams.toString()
  return `${defaultBasePath}/${path}${query ? `?${query}` : ''}`
}

function getErrorMessage(payload, fallback) {
  return payload?.error?.message ?? fallback
}

async function readJsonResponse(response, fallbackMessage) {
  try {
    return await response.json()
  } catch (error) {
    clientLogger.warn('workspace api returned invalid json', {
      status: response.status,
      error: error instanceof Error ? error.message : 'invalid json',
    })
    return {
      ok: false,
      error: {
        code: 'invalid_json_response',
        message: fallbackMessage,
      },
    }
  }
}

export function createWorkspaceApiClient({ fetchImpl } = {}) {
  async function request(path, params, fallbackMessage, options = {}) {
    const transport = fetchImpl ?? globalThis.fetch
    if (typeof transport !== 'function') {
      throw new Error('Workspace API is unavailable')
    }

    const response = await transport(buildUrl(path, params), {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
    const payload = await readJsonResponse(response, fallbackMessage)

    if (!response.ok || payload?.ok === false) {
      const message = getErrorMessage(payload, fallbackMessage)
      clientLogger.warn('workspace api request failed', {
        path,
        status: response.status,
        code: payload?.error?.code,
        message,
      })
      emitDiagnostics({
        apiStatus: 'degraded',
        lastError: message,
      })
      throw new Error(message)
    }

    emitDiagnostics({
      apiStatus: 'healthy',
      lastSuccessfulSync: new Date().toISOString(),
      lastError: null,
    })
    return payload.data
  }

  return {
    getWatchlist() {
      return request('watchlist', {}, 'Unable to load watchlist')
    },

    getHealth() {
      return request('health', {}, 'Unable to load system health')
    },

    getMarketOverview(symbol, timeframe = '1D') {
      return request('market-overview', { symbol, timeframe }, 'Unable to load market overview')
    },

    getStrategySuitability(symbol, timeframe = '1D') {
      return request('strategy-suitability', { symbol, timeframe }, 'Unable to load strategy suitability')
    },

    getTradeQuality(candidate, timeframe = '1D') {
      return request('trade-quality', {
        symbol: candidate?.symbol,
        asOf: candidate?.evaluatedAt,
        scannerSource: candidate?.scannerName,
        timeframe,
      }, 'Unable to evaluate trade quality')
    },

    getDailyBriefing(symbol = 'SPY', timeframe = '1D') {
      return request('daily-briefing', { symbol, timeframe, organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load daily briefing')
    },

    getSignal(symbol) {
      return request('signals', { symbol }, 'Unable to load signal')
    },

    getRiskSummary(symbol) {
      return request('risk-summary', { symbol }, 'Unable to load risk summary')
    },

    getDecision(symbol) {
      return request('decision', { symbol }, 'Unable to load decision intelligence')
    },

    getPortfolioSummary() {
      return request('portfolio-summary', {}, 'Unable to load portfolio summary')
    },

    getEquityCurve() {
      return request('equity-curve', {}, 'Unable to load equity curve')
    },

    getJournalSummary(filters = {}) {
      return request('journal-summary', filters, 'Unable to load journal')
    },

    getOrders() {
      return request('orders', {}, 'Unable to load orders')
    },

    getPositions() {
      return request('positions', {}, 'Unable to load positions')
    },

    getAlerts() {
      return request('alerts', {}, 'Unable to load alerts')
    },

    createAlert(payload) {
      return request('create-alert', {}, 'Unable to create alert', {
        method: 'POST',
        body: payload,
      })
    },

    updateAlert(payload) {
      return request('update-alert', {}, 'Unable to update alert', {
        method: 'POST',
        body: payload,
      })
    },

    deleteAlert(id) {
      return request('delete-alert', {}, 'Unable to delete alert', {
        method: 'POST',
        body: { id },
      })
    },

    evaluateAlerts(context = {}) {
      return request('evaluate-alerts', {}, 'Unable to evaluate alerts', {
        method: 'POST',
        body: context,
      })
    },

    getScanners() {
      return request('scanners', {}, 'Unable to load scanners')
    },

    createScanner(payload) {
      return request('create-scanner', {}, 'Unable to create scanner', {
        method: 'POST',
        body: payload,
      })
    },

    updateScanner(payload) {
      return request('update-scanner', {}, 'Unable to update scanner', {
        method: 'POST',
        body: payload,
      })
    },

    deleteScanner(id) {
      return request('delete-scanner', {}, 'Unable to delete scanner', {
        method: 'POST',
        body: { id },
      })
    },

    evaluateScanners() {
      return request('evaluate-scanners', {}, 'Unable to evaluate scanners', {
        method: 'POST',
        body: {},
      })
    },

    submitPaperOrder(payload) {
      return request('submit-paper-order', {}, 'Unable to submit paper order', {
        method: 'POST',
        body: {
          paperTrading: true,
          ...payload,
        },
      })
    },

    cancelPaperOrder(orderId) {
      return request('cancel-paper-order', {}, 'Unable to cancel paper order', {
        method: 'POST',
        body: { orderId },
      })
    },

    recalculatePortfolio() {
      return request('recalculate-portfolio', {}, 'Unable to recalculate portfolio', {
        method: 'POST',
        body: { paperTrading: true },
      })
    },
  }
}

export const workspaceApiClient = createWorkspaceApiClient()
