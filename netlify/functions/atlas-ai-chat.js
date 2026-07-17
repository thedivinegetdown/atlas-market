import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { ATLAS_AI_CATEGORIES, createAtlasAiGateway, createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { assertAllowedEnum, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst', 'viewer'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas AI access denied', { statusCode: 403, publicMessage: 'atlas ai access denied' })
}

export function createAtlasAiChatHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    const requestCategory = assertAllowedEnum(body.requestCategory ?? 'natural_language_query', ATLAS_AI_CATEGORIES, 'requestCategory')
    const gateway = options.atlasAiGateway ?? createAtlasAiGateway(options)
    const repository = options.atlasAiRepository ?? createAtlasAiRepository(options)
    const result = await gateway.run({
      ...body,
      tenantContext: { ...tenantContext, role: membership.role },
      accountId,
      requestCategory,
    }, { timeoutMs: options.aiConfig?.timeoutMs, signingSecret: undefined })
    const saved = await repository.createRequest?.(result.atlasAiRequest)
    await repository.upsertHealth?.({ ...result.providerHealth, tenantContext, accountId })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'atlas-ai-chat', status: result.atlasAiRequest.status }),
      atlasAi: { ...result, persisted: saved?.ok },
      paperTrading: true,
      advisoryOnly: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'atlas-ai-chat', maxRequestBytes: 32 * 1024, ...options })
}

export const handler = createAtlasAiChatHandler()
