import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { requireSymbol } from '../../lib/workspace/validators.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

const ALLOWED_FIELDS = new Set(['symbol', 'timeframe'])
const ALLOWED_TIMEFRAMES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])

export function createDailyBriefingHandler({ serviceFactory = createWorkspaceDataService, ...handlerOptions } = {}) {
  return createAuthenticatedApiHandler(({ query }) => {
    const unsupported = Object.keys(query).find((field) => !ALLOWED_FIELDS.has(field))
    if (unsupported) return { ok: false, statusCode: 400, error: { code: 'unsupported_briefing_parameters', message: 'custom briefing parameters are not supported' } }
    const symbol = requireSymbol(query.symbol ?? 'SPY')
    if (!symbol.ok) return symbol
    const timeframe = String(query.timeframe ?? '1D').trim().toUpperCase()
    if (!ALLOWED_TIMEFRAMES.has(timeframe)) return { ok: false, statusCode: 400, error: { code: 'invalid_timeframe', message: 'timeframe is invalid' } }
    return serviceFactory().getDailyBriefing(symbol.symbol, { timeframe })
  }, { requiredPermission: 'dashboard.read', routeId: 'daily-briefing', ...handlerOptions })
}

export const handler = createDailyBriefingHandler()
