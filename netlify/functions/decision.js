import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'
import { requireSymbol } from '../../lib/workspace/validators.js'

export const handler = createProtectedWorkspaceApiHandler(({ query, service }) => {
  const validation = requireSymbol(query.symbol)
  if (!validation.ok) return { ok: false, statusCode: 400, error: validation.error }

  return service.getDecision(validation.symbol)
}, { routeId: 'decision' })
