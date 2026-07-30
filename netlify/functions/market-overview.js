import { createApiHandler } from './_shared/api.js'
import { requireSymbol } from '../../lib/workspace/validators.js'

const ALLOWED_TIMEFRAMES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])

export const handler = createApiHandler(({ query, service }) => {
  const validation = requireSymbol(query.symbol)
  if (!validation.ok) return validation
  const timeframe = String(query.timeframe ?? '1D').trim().toUpperCase()
  if (!ALLOWED_TIMEFRAMES.has(timeframe)) {
    return { ok: false, statusCode: 400, error: { code: 'invalid_timeframe', message: 'timeframe is invalid' } }
  }
  return service.getMarketOverview(validation.symbol, { timeframe })
})
