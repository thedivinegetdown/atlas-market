import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPolicyExceptionRepository, updatePolicyExceptionStatus } from '../../lib/system/controlAssuranceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'policy exception status update denied', { statusCode: 403, publicMessage: 'policy exception status update denied' })
}

export function createPolicyExceptionStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.policyExceptionRepository ?? createPolicyExceptionRepository(options)
    const updated = await updatePolicyExceptionStatus({ id: body.id, tenantContext, exceptionStatus: body.exceptionStatus }, { repository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'policy-exception-status-update', status: updated.status }), updated, automaticExceptionApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'policy-exception-status-update', ...options })
}

export const handler = createPolicyExceptionStatusUpdateHandler()
