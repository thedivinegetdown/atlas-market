import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { requireSymbol } from '../../lib/workspace/validators.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

const ALLOWED_TIMEFRAMES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])
const ALLOWED_QUERY_FIELDS = new Set(['symbol', 'timeframe'])

export function createStrategySuitabilityHandler({
  serviceFactory = createWorkspaceDataService,
  ...handlerOptions
} = {}) {
  return createAuthenticatedApiHandler(({ query }) => {
    const unsupportedField = Object.keys(query).find((field) => !ALLOWED_QUERY_FIELDS.has(field))
    if (unsupportedField) {
      return { ok: false, statusCode: 400, error: { code: 'unsupported_strategy_parameters', message: 'custom strategy suitability parameters are not supported' } }
    }
    const validation = requireSymbol(query.symbol)
    if (!validation.ok) return validation
    const timeframe = String(query.timeframe ?? '1D').trim().toUpperCase()
    if (!ALLOWED_TIMEFRAMES.has(timeframe)) {
      return { ok: false, statusCode: 400, error: { code: 'invalid_timeframe', message: 'timeframe is invalid' } }
    }
    return serviceFactory().getStrategySuitability(validation.symbol, { timeframe })
  }, { requiredPermission: 'dashboard.read', routeId: 'strategy-suitability', ...handlerOptions })
}

export const handler = createStrategySuitabilityHandler()
