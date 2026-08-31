import { clientLogger } from '../utils/clientLogger.js'
import { notifySessionExpired, readIdentityAccessToken } from '../auth/identitySession.js'

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

export function createWorkspaceApiClient({ fetchImpl, accessTokenProvider = readIdentityAccessToken } = {}) {
  let csrfState = null

  function clearCsrfState() {
    csrfState = null
  }

  async function establishCsrf(transport, accessToken) {
    if (!accessToken) throw new Error('Authentication is required before a mutation')
    if (csrfState?.accessToken === accessToken && csrfState.expiresAt > Date.now() + 5_000) return csrfState.token
    const response = await transport(buildUrl('csrf-token'), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    })
    const payload = await readJsonResponse(response, 'Unable to establish request protection')
    if (!response.ok || !payload?.data?.token) throw new Error(getErrorMessage(payload, 'Unable to establish request protection'))
    csrfState = { accessToken, token: payload.data.token, expiresAt: new Date(payload.data.expiresAt).getTime() }
    return csrfState.token
  }

  async function request(path, params, fallbackMessage, options = {}) {
    const transport = fetchImpl ?? globalThis.fetch
    if (typeof transport !== 'function') {
      throw new Error('Workspace API is unavailable')
    }

    const tokenResult = accessTokenProvider?.()
    const accessToken = tokenResult && typeof tokenResult.then === 'function' ? await tokenResult : tokenResult
    if (csrfState && csrfState.accessToken !== accessToken) clearCsrfState()
    const method = options.method ?? 'GET'
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

    async function send(csrfToken) {
      const response = await transport(buildUrl(path, params), {
        method,
        headers: {
          accept: 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      })
      return { response, payload: await readJsonResponse(response, fallbackMessage) }
    }

    let result = await send(mutation ? await establishCsrf(transport, accessToken) : null)
    if (mutation && result.response.status === 403 && ['csrf_invalid', 'csrf_expired'].includes(result.payload?.error?.code)) {
      clearCsrfState()
      result = await send(await establishCsrf(transport, accessToken))
    }
    const { response, payload } = result

    if (response.status === 401) notifySessionExpired()

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
    clearCsrfState,
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
        opportunityId: candidate?.opportunityId ?? candidate?.id,
        strategyId: candidate?.strategyId,
        timeframe,
      }, 'Unable to evaluate trade quality')
    },

    saveReviewedOpportunity(qualitySnapshot) {
      return request('opportunity-intelligence', {}, 'Unable to save reviewed opportunity', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', qualitySnapshot },
      })
    },

    getDailyBriefing(symbol = 'SPY', timeframe = '1D') {
      return request('daily-briefing', { symbol, timeframe, organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load daily briefing')
    },
    runPaperEvaluation() {
      return request('paper-evaluation', {}, 'Unable to run paper evaluation', { method: 'POST', body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', symbol: 'SPY' } })
    },
    simulateApprovedPaperTrades() {
      return request('paper-order-simulation', {}, 'Unable to simulate approved paper trades', { method: 'POST', body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' } })
    },

    getSignal(symbol) {
      return request('signals', { symbol, organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load signal')
    },

    getRiskSummary(symbol) {
      return request('risk-summary', { symbol, organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load risk summary')
    },

    getDecision(symbol) {
      return request('decision', { symbol, organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load decision intelligence')
    },
    async getDecisionIntelligence(planId) {
      const response = await request('decision-intelligence', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', planId }, 'Unable to load decision intelligence')
      if (!response?.decisionIntelligence || typeof response.decisionIntelligence !== 'object') {
        throw new Error('Decision intelligence response is unavailable')
      }
      return response.decisionIntelligence
    },

    getPortfolioSummary() {
      return request('paper-workspace-projection', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load portfolio summary')
    },
    getPaperPerformanceReview() {
      return request('paper-performance-review', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load paper performance review')
    },
    getPaperLearningEvidence() {
      return request('paper-learning', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load paper learning evidence')
    },
    getPaperExitPositions() {
      return request('paper-position-exit', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load simulated paper positions')
    },
    exitPaperPosition(positionId, quantity) {
      return request('paper-position-exit', {}, 'Unable to simulate paper position exit', { method: 'POST', body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', positionId, quantity, confirmed: true, paperTrading: true } })
    },

    getEquityCurve() {
      return request('equity-curve', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load equity curve')
    },

    getJournalSummary(filters = {}) {
      return request('paper-workspace-projection', { ...filters, view: 'journal', organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load journal')
    },

    getOrders() {
      return request('orders', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load orders')
    },

    getPositions() {
      return request('positions', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load positions')
    },

    getAlerts() {
      return request('alert-configurations', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load alerts')
    },

    createAlert(payload) {
      return request('alert-configurations', {}, 'Unable to create alert', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'create', alert: payload },
      })
    },

    updateAlert(payload) {
      return request('alert-configurations', {}, 'Unable to update alert', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'update', id: payload.id, alert: payload },
      })
    },

    deleteAlert(id) {
      return request('alert-configurations', {}, 'Unable to delete alert', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'delete', id },
      })
    },

    evaluateAlerts(context = {}) {
      return request('alert-configurations', {}, 'Unable to evaluate alerts', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'evaluate', context },
      })
    },

    getScanners() {
      return request('scanner-configurations', { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, 'Unable to load scanners')
    },

    createScanner(payload) {
      return request('scanner-configurations', {}, 'Unable to create scanner', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'create', scanner: payload },
      })
    },

    updateScanner(payload) {
      return request('scanner-configurations', {}, 'Unable to update scanner', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'update', id: payload.id, scanner: payload },
      })
    },

    deleteScanner(id) {
      return request('scanner-configurations', {}, 'Unable to delete scanner', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'delete', id },
      })
    },

    evaluateScanners() {
      return request('scanner-configurations', {}, 'Unable to evaluate scanners', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', action: 'evaluate' },
      })
    },

    submitPaperOrder(payload) {
      return request('submit-paper-order', {}, 'Unable to submit paper order', {
        method: 'POST',
        body: {
          organizationId: 'org-atlas-local',
          accountId: 'paper-portfolio',
          paperTrading: true,
          ...payload,
        },
      })
    },

    cancelPaperOrder(orderId) {
      return request('cancel-paper-order', {}, 'Unable to cancel paper order', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', orderId },
      })
    },

    recalculatePortfolio() {
      return request('recalculate-portfolio', {}, 'Unable to recalculate portfolio', {
        method: 'POST',
        body: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', paperTrading: true },
      })
    },
  }
}

export const workspaceApiClient = createWorkspaceApiClient()

export function clearWorkspaceCsrfState() {
  workspaceApiClient.clearCsrfState()
}
