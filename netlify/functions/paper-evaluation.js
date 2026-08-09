import { createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createPaperEvaluationHandler({ opportunityRepository, serviceFactory = createWorkspaceDataService, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ body, tenantContext, user }) => {
    const repository = opportunityRepository ?? createAtlasAiRepository(options)
    const accountId = requireAccountContext(body.accountId ?? 'paper-portfolio')
    const context = { tenantContext, accountId, userId: tenantContext.userId ?? user.id }
    const [candidates, existingEvaluations] = await Promise.all([repository.listTradeQualityReviews({ ...context, limit: 5 }), repository.listPaperEvaluations(context)])
    const result = await serviceFactory().runPaperEvaluation({ symbol: body.symbol ?? 'SPY', timeframe: '1D', candidates, existingEvaluations })
    for (const evaluation of result.evaluations.filter((item) => !item.reused)) await repository.savePaperEvaluation({ ...context, evaluation })
    return { ...result, candidateLimit: 5, manualTrigger: true, overlappingRuns: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-evaluation', maxRequestBytes: 8 * 1024, ...options })
}
export const handler = createPaperEvaluationHandler()
