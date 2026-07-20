import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import {
  createPortfolioIntelligenceRepository,
  evaluatePortfolioIntelligence,
  validatePortfolioHistoryFilters,
} from '../../lib/portfolio/portfolioIntelligenceEngine.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas portfolio intelligence access denied', { statusCode: 403, publicMessage: 'portfolio intelligence access denied' })
}

export function createAtlasPortfolioIntelligenceHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, user }) => {
    assertAccess(membership)
    if (body.providerUrl || body.baseUrl || body.privateUrl || body.model || body.providerDescriptorId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas portfolio provider selection is not allowed', { statusCode: 400, publicMessage: 'provider selection is not allowed' })
    }
    const accountId = requireAccountContext(options.accountId ?? query.accountId ?? body.accountId)
    const action = String(body.action ?? query.action ?? 'evaluate').toLowerCase()
    const repository = options.portfolioIntelligenceRepository ?? createPortfolioIntelligenceRepository(options)
    if (action === 'history') {
      const filters = validatePortfolioHistoryFilters({ ...query, ...body.filters, limit: body.limit ?? body.filters?.limit ?? query.limit })
      const history = await repository.listSnapshots?.({
        ...filters,
        tenantContext,
        accountId,
        userId: tenantContext.userId ?? user?.id,
      }) ?? []
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'atlas-portfolio-intelligence', status: 'history' }),
        history,
        pagination: { limit: filters.limit, returned: history.length, bounded: true },
        advisoryOnly: true,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
      }
    }
    if (action !== 'evaluate') {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Atlas portfolio intelligence action is invalid', { statusCode: 400, publicMessage: 'portfolio intelligence action is invalid' })
    }
    const result = await evaluatePortfolioIntelligence({
      ...body,
      tenantContext: { ...tenantContext, role: membership.role },
      accountId,
      portfolioId: accountId,
      correlationId: body.correlationId ?? requestId,
      sessionId: body.sessionId ?? `atlas-portfolio-intelligence-${tenantContext.userId ?? 'user'}`,
    }, {
      atlasAiGateway: options.atlasAiGateway,
      aiConfig: options.aiConfig,
      providers: options.providers,
      env: options.env,
      timeoutMs: options.aiConfig?.timeoutMs,
      emitEvent: false,
    })
    const saved = await repository.createSnapshot?.({
      ...result,
      tenantContext,
      accountId,
      userId: tenantContext.userId ?? user?.id,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'atlas-portfolio-intelligence', status: result.status }),
      portfolioIntelligence: result,
      portfolioHistoryPersisted: saved?.ok === true,
      advisoryOnly: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'atlas-portfolio-intelligence', maxRequestBytes: 64 * 1024, ...options })
}

export const handler = createAtlasPortfolioIntelligenceHandler()
