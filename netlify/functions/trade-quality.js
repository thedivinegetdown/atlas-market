import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { requireSymbol } from '../../lib/workspace/validators.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

const ALLOWED_QUERY_FIELDS = new Set(['symbol', 'timeframe', 'asOf', 'scannerSource', 'opportunityId', 'strategyId'])
const ALLOWED_TIMEFRAMES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])

export function createTradeQualityHandler({ serviceFactory = createWorkspaceDataService, ...handlerOptions } = {}) {
  return createAuthenticatedApiHandler(({ query }) => {
    const unsupported = Object.keys(query).find((field) => !ALLOWED_QUERY_FIELDS.has(field))
    if (unsupported) return { ok: false, statusCode: 400, error: { code: 'unsupported_trade_quality_parameters', message: 'custom trade quality parameters are not supported' } }
    const validation = requireSymbol(query.symbol)
    if (!validation.ok) return validation
    const timeframe = String(query.timeframe ?? '1D').trim().toUpperCase()
    if (!ALLOWED_TIMEFRAMES.has(timeframe)) return { ok: false, statusCode: 400, error: { code: 'invalid_timeframe', message: 'timeframe is invalid' } }
    const asOf = String(query.asOf ?? '').trim()
    if (asOf && Number.isNaN(Date.parse(asOf))) return { ok: false, statusCode: 400, error: { code: 'invalid_candidate_timestamp', message: 'candidate timestamp is invalid' } }
    return serviceFactory().getTradeQuality({
      symbol: validation.symbol,
      asOf: asOf || undefined,
      timeframe: 'swing',
      scannerSource: String(query.scannerSource ?? 'deterministic-scanner').slice(0, 80),
      opportunityId: String(query.opportunityId ?? '').trim().slice(0, 160) || undefined,
      strategyId: String(query.strategyId ?? '').trim().slice(0, 140) || undefined,
    }, { timeframe })
  }, { requiredPermission: 'dashboard.read', routeId: 'trade-quality', ...handlerOptions })
}

export const handler = createTradeQualityHandler()
