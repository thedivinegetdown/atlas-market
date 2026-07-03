import { createApiHandler } from './_shared/api.js'
import { requireSymbol } from '../../lib/workspace/validators.js'

export const handler = createApiHandler(({ body, service, requestId }) => {
  const validation = requireSymbol(body.symbol)
  if (!validation.ok) return validation

  return service.submitPaperOrder({
    ...body,
    symbol: validation.symbol,
  }, { requestId })
}, { allowedMethods: ['POST'] })
