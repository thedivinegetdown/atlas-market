import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'
import { normalizeSymbol, isValidSymbol } from '../../lib/workspace/validators.js'

export const handler = createProtectedWorkspaceApiHandler(({ query, service }) => {
  const symbol = query.symbol && String(query.symbol).toLowerCase() !== 'all'
    ? normalizeSymbol(query.symbol)
    : 'all'
  const result = query.result ?? 'all'

  if (symbol !== 'all' && !isValidSymbol(symbol)) {
    return {
      ok: false,
      error: {
        code: 'invalid_symbol',
        message: 'symbol is invalid',
      },
    }
  }

  if (!['all', 'win', 'loss', 'neutral'].includes(result)) {
    return {
      ok: false,
      error: {
        code: 'invalid_result',
        message: 'result filter is invalid',
      },
    }
  }

  return service.getJournalSummary({
    search: query.search ?? '',
    symbol,
    result,
  })
}, { routeId: 'journal-summary' })
