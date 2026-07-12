import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createCompliancePostImplementationReviewRepository, reviewCompliancePostImplementation } from '../../lib/system/compliancePostImplementationReviewEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance post-implementation review access denied', { statusCode: 403, publicMessage: 'compliance post-implementation review access denied' })
}

export function createCompliancePostImplementationReviewsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.compliancePostImplementationReviewRepository ?? createCompliancePostImplementationReviewRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.review, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-post-implementation-reviews', status: response.ok ? 'reviewed' : 'blocked' }), review: response.review, automaticEffectivenessClaim: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, reviewStatus: query.reviewStatus, limit: query.limit }) ?? []
    const compliancePostImplementationReview = reviewCompliancePostImplementation({ tenantContext, compliancePostImplementationReviews: existing, complianceChangeClosureReadiness: options.complianceChangeClosureReadiness, complianceChangeVerification: options.complianceChangeVerification }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-post-implementation-reviews', status: compliancePostImplementationReview.postImplementationReviewStatus }), compliancePostImplementationReview, automaticEffectivenessClaim: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-post-implementation-reviews', ...options })
}

export const handler = createCompliancePostImplementationReviewsHandler()
