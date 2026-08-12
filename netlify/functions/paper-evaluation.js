import { assertDurablePaperEvidenceWrite, resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createPaperEvaluationHandler({ opportunityRepository, serviceFactory = createWorkspaceDataService, env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ body, tenantContext, user, repository: persistenceRepository }) => {
    const repository = resolveCanonicalPaperEvidenceRepository({ opportunityRepository, persistenceRepository, env })
    const accountId = requireAccountContext(body.accountId ?? 'paper-portfolio')
    const context = { tenantContext, accountId, userId: tenantContext.userId ?? user.id }
    const [candidates, existingEvaluations] = await Promise.all([repository.listTradeQualityReviews({ ...context, limit: 5 }), repository.listPaperEvaluations(context)])
    const result = await serviceFactory().runPaperEvaluation({ symbol: body.symbol ?? 'SPY', timeframe: '1D', candidates, existingEvaluations })
    const evaluations = []
    for (const evaluation of result.evaluations) {
      if (evaluation.reused) { evaluations.push(evaluation); continue }
      const saved = assertDurablePaperEvidenceWrite(await repository.savePaperEvaluation({ ...context, evaluation }))
      evaluations.push(saved.duplicate ? { ...evaluation, reused: true, durableDuplicate: true } : evaluation)
    }
    return { ...result, evaluations, candidateLimit: 5, manualTrigger: true, overlappingRuns: false, durableEvidence: true }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-evaluation', maxRequestBytes: 8 * 1024, env, ...options })
}
export const handler = createPaperEvaluationHandler()
