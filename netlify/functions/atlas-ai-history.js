import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst', 'viewer'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas AI history access denied', { statusCode: 403, publicMessage: 'atlas ai history access denied' })
}

export function createAtlasAiHistoryHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertAccess(membership)
    const accountId = requireAccountContext(query.accountId ?? options.accountId)
    const repository = options.atlasAiRepository ?? createAtlasAiRepository(options)
    const history = await repository.list?.({ tenantContext, accountId, userId: tenantContext.userId, sessionId: query.sessionId, requestCategory: query.requestCategory, limit: query.limit }) ?? []
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'atlas-ai-history', status: 'ok' }),
      atlasAiHistory: history,
      paperTrading: true,
      advisoryOnly: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'atlas-ai-history', ...options })
}

export const handler = createAtlasAiHistoryHandler()
