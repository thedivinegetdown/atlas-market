import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAtlasAiGateway } from '../../lib/ai/atlasAiGateway.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas AI health access denied', { statusCode: 403, publicMessage: 'atlas ai health access denied' })
}

export function createAtlasAiHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertAccess(membership)
    const accountId = requireAccountContext(query.accountId ?? options.accountId)
    const gateway = options.atlasAiGateway ?? createAtlasAiGateway(options)
    const health = await gateway.health({ tenantContext, accountId })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'atlas-ai-health', status: health.providerHealth.status }),
      atlasAiHealth: health,
      paperTrading: true,
      advisoryOnly: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'atlas-ai-health', ...options })
}

export const handler = createAtlasAiHealthHandler()
