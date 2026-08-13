import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'
import { requireSymbol } from '../../lib/workspace/validators.js'

export const handler = createProtectedWorkspaceApiHandler(({ body, service, requestId }) => {
  const validation = requireSymbol(body.symbol)
  if (!validation.ok) return validation

  return service.submitPaperOrder({
    ...body,
    symbol: validation.symbol,
  }, { requestId })
}, { allowedMethods: ['POST'], mutation: true, routeId: 'submit-paper-order' })
