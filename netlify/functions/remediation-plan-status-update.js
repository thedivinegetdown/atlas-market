import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRemediationPlanRepository, updateRemediationPlanExecution } from '../../lib/system/remediationPlanningEngine.js'
import { sanitizeId, apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'remediation plan status denied', { statusCode: 403, publicMessage: 'remediation plan status denied' })
}

export function createRemediationPlanStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.remediationRepository ?? createRemediationPlanRepository(options)
    const update = await updateRemediationPlanExecution({ id: sanitizeId(body.id, 'plan id'), tenantContext, executionStatus: body.executionStatus, completionSummary: body.completionSummary }, { repository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'remediation-plan-status-update', status: update.status }), update, humanReviewOnly: true, dashboardExecution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'remediation-plan-status-update', ...options })
}

export const handler = createRemediationPlanStatusUpdateHandler()
