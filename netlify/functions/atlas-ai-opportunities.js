import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { ATLAS_AI_CATEGORIES, createAtlasAiGateway, createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { OPPORTUNITY_ANALYSIS_CATEGORIES, validateOpportunityAnalysisRequest } from '../../lib/ai/opportunityAnalysisEngine.js'
import { assertAllowedEnum, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas opportunity analysis access denied', { statusCode: 403, publicMessage: 'atlas ai access denied' })
}

export function createAtlasAiOpportunitiesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    if (body.providerUrl || body.baseUrl || body.privateUrl || body.model || body.providerDescriptorId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas opportunity provider selection is not allowed', { statusCode: 400, publicMessage: 'provider selection is not allowed' })
    }
    const accountId = requireAccountContext(options.accountId ?? query.accountId ?? body.accountId)
    const requestCategory = assertAllowedEnum(body.requestCategory ?? 'opportunity_ranking', OPPORTUNITY_ANALYSIS_CATEGORIES.filter((category) => ATLAS_AI_CATEGORIES.includes(category)), 'requestCategory')
    const request = validateOpportunityAnalysisRequest({ ...body, requestCategory }, options.aiConfig ?? {})
    const gateway = options.atlasAiGateway ?? createAtlasAiGateway(options)
    const repository = options.atlasAiRepository ?? createAtlasAiRepository(options)
    const result = await gateway.run({
      ...body,
      tenantContext: { ...tenantContext, role: membership.role },
      accountId,
      requestCategory,
      analysisCategory: request.category,
      timeframe: request.timeframe,
      limit: request.limit,
      symbols: request.symbols,
      candidates: body.candidates ?? [],
      sessionId: body.sessionId ?? `atlas-ai-opportunity-${tenantContext.userId ?? 'user'}`,
      correlationId: body.correlationId ?? requestId,
    }, { timeoutMs: options.aiConfig?.timeoutMs, correlationId: requestId, signingSecret: undefined })
    const saved = await repository.createRequest?.(result.atlasAiRequest)
    const opportunitySaved = await repository.createOpportunityAnalysisHistory?.({
      ...result.atlasAiRequest,
      atlasAiResponse: result.atlasAiResponse,
      requestId,
      tenantContext,
      accountId,
    })
    await repository.upsertHealth?.({ ...result.providerHealth, tenantContext, accountId })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'atlas-ai-opportunities', status: result.atlasAiRequest.status }),
      atlasAi: { ...result, persisted: saved?.ok, opportunityHistoryPersisted: opportunitySaved?.ok === true },
      paperTrading: true,
      advisoryOnly: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'atlas-ai-opportunities', maxRequestBytes: 64 * 1024, ...options })
}

export const handler = createAtlasAiOpportunitiesHandler()
