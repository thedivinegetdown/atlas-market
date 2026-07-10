import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceReviewFindingRepository, updateComplianceReviewFindingStatus } from '../../lib/system/complianceReviewFindingTrackerEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance review finding status update denied', { statusCode: 403, publicMessage: 'compliance review finding status update denied' })
}

export function createComplianceReviewFindingStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceReviewFindingRepository ?? createComplianceReviewFindingRepository(options)
    const updated = await updateComplianceReviewFindingStatus({ id: body.id, tenantContext, findingStatus: body.findingStatus }, { repository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-finding-status-update', status: updated.status }), updated, automaticFindingResolution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-review-finding-status-update', ...options })
}

export const handler = createComplianceReviewFindingStatusUpdateHandler()
