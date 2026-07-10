import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceExternalReviewRequestRepository, planComplianceExternalReviews } from '../../lib/system/complianceExternalReviewPlannerEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance external review access denied', { statusCode: 403, publicMessage: 'compliance external review access denied' })
}

export function createComplianceExternalReviewRequestsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceExternalReviewRequestRepository ?? createComplianceExternalReviewRequestRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.reviewRequest, tenantContext, requestedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-external-review-requests', status: response.ok ? 'planned' : 'blocked' }), reviewRequest: response.reviewRequest, automaticSubmission: false, automaticDistribution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, requestStatus: query.requestStatus, requestType: query.requestType, limit: query.limit }) ?? []
    const complianceExternalReviewPlanning = planComplianceExternalReviews({
      tenantContext,
      complianceExternalReviewRequests: existing,
      complianceAuditReadinessPackage: options.complianceAuditReadinessPackage,
      complianceGovernanceReadout: options.complianceGovernanceReadout,
      complianceReviewCalendar: options.complianceReviewCalendar,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-external-review-requests', status: complianceExternalReviewPlanning.externalReviewStatus }), complianceExternalReviewPlanning, automaticSubmission: false, automaticDistribution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-external-review-requests', ...options })
}

export const handler = createComplianceExternalReviewRequestsHandler()
