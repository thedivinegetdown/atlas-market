import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'
import { requireSymbol } from '../../lib/workspace/validators.js'

const ALLOWED_TIMEFRAMES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])

const ALLOWED_QUERY_FIELDS = new Set(['symbol', 'timeframe'])

export function createMarketOverviewHandler({
  serviceFactory = createWorkspaceDataService,
  ...handlerOptions
} = {}) {
  return createAuthenticatedApiHandler(({ query }) => {
  const unsupportedField = Object.keys(query).find((field) => !ALLOWED_QUERY_FIELDS.has(field))
  if (unsupportedField) {
    return { ok: false, statusCode: 400, error: { code: 'unsupported_history_parameters', message: 'custom historical request parameters are not supported' } }
  }
  const validation = requireSymbol(query.symbol)
  if (!validation.ok) return validation
  const timeframe = String(query.timeframe ?? '1D').trim().toUpperCase()
  if (!ALLOWED_TIMEFRAMES.has(timeframe)) {
    return { ok: false, statusCode: 400, error: { code: 'invalid_timeframe', message: 'timeframe is invalid' } }
  }
  return serviceFactory().getMarketOverview(validation.symbol, { timeframe, includeHistoricalIntelligence: true })
  }, { requiredPermission: 'dashboard.read', routeId: 'market-overview', ...handlerOptions })
}

export const handler = createMarketOverviewHandler()
