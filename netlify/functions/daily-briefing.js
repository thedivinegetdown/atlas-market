import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { requireSymbol } from '../../lib/workspace/validators.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

const ALLOWED_FIELDS = new Set(['symbol', 'timeframe', 'organizationId', 'workspaceId', 'accountId'])
const ALLOWED_TIMEFRAMES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])

export function createDailyBriefingHandler({ serviceFactory = createWorkspaceDataService, opportunityRepository, ...handlerOptions } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ query, tenantContext, user }) => {
    const unsupported = Object.keys(query).find((field) => !ALLOWED_FIELDS.has(field))
    if (unsupported) return { ok: false, statusCode: 400, error: { code: 'unsupported_briefing_parameters', message: 'custom briefing parameters are not supported' } }
    const symbol = requireSymbol(query.symbol ?? 'SPY')
    if (!symbol.ok) return symbol
    const timeframe = String(query.timeframe ?? '1D').trim().toUpperCase()
    if (!ALLOWED_TIMEFRAMES.has(timeframe)) return { ok: false, statusCode: 400, error: { code: 'invalid_timeframe', message: 'timeframe is invalid' } }
    const accountId = requireAccountContext(query.accountId ?? 'paper-portfolio')
    const repository = opportunityRepository ?? createAtlasAiRepository(handlerOptions)
    const reviewedOpportunities = await repository.listTradeQualityReviews({ tenantContext, accountId, userId: tenantContext.userId ?? user.id, limit: 3 })
    return serviceFactory().getDailyBriefing(symbol.symbol, { timeframe, reviewedOpportunities })
  }, { requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'daily-briefing', ...handlerOptions })
}

export const handler = createDailyBriefingHandler()
