import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceReviewFindingRepository, trackComplianceReviewFindings } from '../../lib/system/complianceReviewFindingTrackerEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance review finding access denied', { statusCode: 403, publicMessage: 'compliance review finding access denied' })
}

export function createComplianceReviewFindingsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceReviewFindingRepository ?? createComplianceReviewFindingRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.reviewFinding, tenantContext, ownerUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-findings', status: response.ok ? 'tracked' : 'blocked' }), reviewFinding: response.finding, automaticFindingResolution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, findingStatus: query.findingStatus, findingSeverity: query.findingSeverity, limit: query.limit }) ?? []
    const reviewFindingTracker = trackComplianceReviewFindings({ tenantContext, complianceReviewFindings: existing, complianceReviewWorkflow: options.complianceReviewWorkflow, complianceEvidenceRequestQueue: options.complianceEvidenceRequestQueue, complianceObligationMapping: options.complianceObligationMapping }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-findings', status: reviewFindingTracker.trackerStatus }), reviewFindingTracker, automaticFindingResolution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-review-findings', ...options })
}

export const handler = createComplianceReviewFindingsHandler()
