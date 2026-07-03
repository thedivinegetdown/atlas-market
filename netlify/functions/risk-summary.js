import { createApiHandler } from './_shared/api.js'
import { requireSymbol } from '../../lib/workspace/validators.js'

export const handler = createApiHandler(({ query, service }) => {
  const validation = requireSymbol(query.symbol)
  if (!validation.ok) return validation

  return service.getRiskSummary(validation.symbol)
})
