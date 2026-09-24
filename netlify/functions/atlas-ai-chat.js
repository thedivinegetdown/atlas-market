import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { ATLAS_AI_CATEGORIES, ATLAS_AI_PROMPT_TEMPLATES, createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { loadAtlasGrounding } from '../../lib/ai/atlasServerGrounding.js'
import { runGroundedAdvisory } from '../../lib/ai/atlasGroundedAdvisory.js'
import { assertAllowedEnum, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createAtlasAiChatHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, repository }) => {
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    const requestCategory = assertAllowedEnum(body.requestCategory ?? 'natural_language_query', ATLAS_AI_CATEGORIES, 'requestCategory')
    if (!ATLAS_AI_PROMPT_TEMPLATES[requestCategory].allowedRoles.includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas AI access denied', { statusCode: 403, publicMessage: 'atlas ai access denied' })
    if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Question is invalid', { statusCode: 400, publicMessage: 'question is invalid' })
    const grounding = await loadAtlasGrounding({ tenantContext, accountId, repository, evidenceRepository: options.evidenceRepository, ledgerRepository: options.ledgerRepository, env: options.env })
    const result = await runGroundedAdvisory({ grounding, question: body.question, requestCategory, tenantContext, accountId, sessionId: body.sessionId }, { provider: options.groundedProvider, enabled: options.aiConfig?.enabled !== false, timeoutMs: options.aiConfig?.timeoutMs })
    const audit = options.atlasAiRepository ?? createAtlasAiRepository({ database: repository })
    let persisted = false
    try { const saved = await audit.createRequest?.(result.atlasAiRequest); persisted = saved?.ok === true && saved?.disabled !== true } catch { /* Audit failure cannot grant AI authority. */ }
    const data = { event: apiFoundationEvent({ requestId, endpoint: 'atlas-ai-chat', status: result.atlasAiRequest.status }), paperTrading: true, advisoryOnly: true, liveOrders: false, brokerExecution: false }
    if (body.stream === true) {
      // Validate before releasing anything; never stream unchecked model text.
      return { ...data, atlasAiStream: { streamEvents: [{ streamEventType: 'completed', metadata: { response: result.atlasAiResponse, atlasAiRequest: result.atlasAiRequest, providerHealth: result.providerHealth } }], persisted, incompletePersistedAsCompleted: false, correlationId: requestId } }
    }
    return { ...data, atlasAi: { ...result, persisted } }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'atlas-ai-chat', maxRequestBytes: 32 * 1024, ...options })
}
export const handler = createAtlasAiChatHandler()
