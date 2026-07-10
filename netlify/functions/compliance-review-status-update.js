import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceReviewWorkflowRepository, updateComplianceReviewWorkflowStatus } from '../../lib/system/complianceReviewWorkflowEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance review status update denied', { statusCode: 403, publicMessage: 'compliance review status update denied' })
}

export function createComplianceReviewStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceReviewWorkflowRepository ?? createComplianceReviewWorkflowRepository(options)
    const updated = await updateComplianceReviewWorkflowStatus({ id: body.id, tenantContext, reviewStatus: body.reviewStatus }, { repository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-status-update', status: updated.status }), updated, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-review-status-update', ...options })
}

export const handler = createComplianceReviewStatusUpdateHandler()
