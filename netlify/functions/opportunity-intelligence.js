import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { assertDurablePaperEvidenceWrite, resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertWriteAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Opportunity review write access denied', { statusCode: 403, publicMessage: 'opportunity review access denied' })
}

export function createOpportunityIntelligenceHandler({ opportunityRepository, env = process.env, ...options } = {}) {
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
      const saved = assertDurablePaperEvidenceWrite(await repository.saveTradeQualityReview({ ...context, qualitySnapshot: body.qualitySnapshot, reviewedAt: body.reviewedAt, expiresAt: body.expiresAt }))
      return { opportunity: saved.history.payload.tradeQualitySnapshot, reviewState: saved.history.reviewState, advisoryOnly: true, paperTradingOnly: true, automaticScoring: false }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message ?? 'Opportunity quality snapshot is invalid', { statusCode: 400, publicMessage: 'opportunity quality snapshot is invalid' })
    }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'opportunity-intelligence', maxRequestBytes: 16 * 1024, env, ...options })
}

export const handler = createOpportunityIntelligenceHandler()
