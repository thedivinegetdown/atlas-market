import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { requireSymbol } from '../../lib/workspace/validators.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { durableWorkspaceRepository, loadDurablePaperProjection } from './_shared/durablePaperWorkspace.js'

const ALLOWED_FIELDS = new Set(['symbol', 'timeframe', 'organizationId', 'workspaceId', 'accountId'])
const ALLOWED_TIMEFRAMES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])

export function createDailyBriefingHandler({ serviceFactory = createWorkspaceDataService, opportunityRepository, ledgerRepository, durableRepository, env = process.env, ...handlerOptions } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ query, tenantContext, user, repository: persistenceRepository }) => {
    const unsupported = Object.keys(query).find((field) => !ALLOWED_FIELDS.has(field))
    if (unsupported) return { ok: false, statusCode: 400, error: { code: 'unsupported_briefing_parameters', message: 'custom briefing parameters are not supported' } }
    const symbol = requireSymbol(query.symbol ?? 'SPY')
    if (!symbol.ok) return symbol
    const timeframe = String(query.timeframe ?? '1D').trim().toUpperCase()
    if (!ALLOWED_TIMEFRAMES.has(timeframe)) return { ok: false, statusCode: 400, error: { code: 'invalid_timeframe', message: 'timeframe is invalid' } }
    const accountId = requireAccountContext(query.accountId ?? 'paper-portfolio')
    const repository = opportunityRepository ?? createAtlasAiRepository(handlerOptions)
    const context = { tenantContext, accountId, userId: tenantContext.userId ?? user.id }
    const workspaceState = durableWorkspaceRepository({ repository: persistenceRepository, durableRepository, env })
    const [reviewedOpportunities, evaluations, durablePaper, alerts] = await Promise.all([
      repository.listTradeQualityReviews({ ...context, limit: 3 }),
      repository.listPaperEvaluations(context),
      loadDurablePaperProjection({ accountId, tenantContext, user, repository: persistenceRepository, ledgerRepository, env }),
      workspaceState.listAlerts(context),
    ])
    const byCandidate = new Map(evaluations.map((item) => [item.candidateId, item]))
    for (const opportunity of reviewedOpportunities) opportunity.paperEvaluation = byCandidate.get(opportunity.opportunityId) ?? null
    return serviceFactory().getDailyBriefing(symbol.symbol, {
      timeframe,
      reviewedOpportunities,
      durablePaperState: { portfolioResult: durablePaper.projection, alerts },
    })
  }, { requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'daily-briefing', env, ...handlerOptions })
}

export const handler = createDailyBriefingHandler()
