import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { assertDurablePaperEvidenceWrite, resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { requireSymbol } from '../../lib/workspace/validators.js'
import { assertNotProvisionalEvidence } from '../../lib/research/rejectProvisionalEvidence.js'

function assertWriteAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Opportunity review write access denied', { statusCode: 403, publicMessage: 'opportunity review access denied' })
}

export function createOpportunityIntelligenceHandler({ opportunityRepository, serviceFactory = createWorkspaceDataService, clock = () => new Date().toISOString(), env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ event, body, query, tenantContext, user, membership, repository: persistenceRepository }) => {
    const repository = resolveCanonicalPaperEvidenceRepository({ opportunityRepository, persistenceRepository, env })
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? 'paper-portfolio')
    const context = { tenantContext, accountId, userId: tenantContext.userId ?? user.id }
    if (String(event.httpMethod).toUpperCase() === 'GET') {
      const opportunities = await repository.listTradeQualityReviews({ ...context, limit: query.limit ?? 3 })
      return { opportunities, bounded: true, advisoryOnly: true, paperTradingOnly: true }
    }
    assertWriteAccess(membership)
    try {
      assertNotProvisionalEvidence(body)
      const reference = body.reviewReference
      if (Object.keys(body).some((key) => !['organizationId', 'accountId', 'reviewReference', 'reviewState'].includes(key))
        || !reference || typeof reference !== 'object' || Array.isArray(reference)
        || Object.keys(reference).some((key) => !['symbol', 'opportunityId', 'strategyId'].includes(key))) throw new Error('Only a review reference is accepted; client quality snapshots are not authority')
      if (!['reviewed', 'saved'].includes(body.reviewState ?? 'saved')) throw new Error('Review state is invalid')
      const validation = requireSymbol(reference.symbol)
      if (!validation.ok || !/^[a-zA-Z0-9_-]{1,160}$/.test(reference.opportunityId ?? '')
        || !/^[a-zA-Z0-9_-]{1,140}$/.test(reference.strategyId ?? '') || reference.strategyId === 'strategy-unknown') throw new Error('Review reference is invalid')
      // Recompute using server-owned authoritative inputs. No client metric, as-of, order or completion claim is used.
      const now = clock()
      const result = await serviceFactory().getTradeQuality({ symbol: validation.symbol, opportunityId: reference.opportunityId, strategyId: reference.strategyId, scannerSource: 'deterministic-scanner', asOf: now }, { timeframe: '1D', now })
      const quality = result?.strategyAttribution?.find((item) => item.strategyId === reference.strategyId)?.quality ?? result?.quality
      assertNotProvisionalEvidence(result)
      if (!quality || quality.symbol !== validation.symbol || quality.opportunityId !== reference.opportunityId
        || quality.strategyId !== reference.strategyId || quality.status !== 'COMPLETE') throw new Error('Server-owned Trade Quality evidence is unavailable or changed; review again')
      const saved = assertDurablePaperEvidenceWrite(await repository.saveTradeQualityReview({ ...context, qualitySnapshot: { ...quality, reviewState: body.reviewState ?? 'saved' } }))
      return { opportunity: saved.history.payload.tradeQualitySnapshot, reviewState: saved.history.reviewState, advisoryOnly: true, paperTradingOnly: true, automaticScoring: false }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message ?? 'Opportunity quality snapshot is invalid', { statusCode: 400, publicMessage: 'opportunity quality snapshot is invalid' })
    }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'opportunity-intelligence', maxRequestBytes: 16 * 1024, env, ...options })
}

export const handler = createOpportunityIntelligenceHandler()
