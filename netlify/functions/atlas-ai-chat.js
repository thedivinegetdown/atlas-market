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
    if (body.stream === true) {
      const streamEvents = []
      for await (const event of gateway.stream({
        ...body,
        tenantContext: { ...tenantContext, role: membership.role },
        accountId,
        requestCategory,
        correlationId: requestId,
      }, { timeoutMs: options.aiConfig?.streamTimeoutMs ?? options.aiConfig?.timeoutMs, correlationId: requestId, signingSecret: undefined })) {
        streamEvents.push(event)
      }
      const completed = streamEvents.find((event) => event.streamEventType === 'completed')
      const atlasAiRequest = completed?.metadata?.atlasAiRequest
      const saved = atlasAiRequest ? await repository.createRequest?.(atlasAiRequest) : { ok: false }
      if (completed?.metadata?.providerHealth) await repository.upsertHealth?.({ ...completed.metadata.providerHealth, tenantContext, accountId })
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'atlas-ai-chat', status: atlasAiRequest?.status ?? 'streamed' }),
        atlasAiStream: {
          streamEvents,
          persisted: saved?.ok === true,
          incompletePersistedAsCompleted: false,
          sessionId: body.sessionId ?? atlasAiRequest?.sessionId ?? null,
          correlationId: requestId,
        },
        paperTrading: true,
        advisoryOnly: true,
        liveOrders: false,
        brokerExecution: false,
      }
    }
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
