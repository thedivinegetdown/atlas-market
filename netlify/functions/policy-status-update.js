import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAdministrativePolicyRepository, updateAdministrativePolicyStatus } from '../../lib/system/administrativePolicyGovernanceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'policy status update denied', { statusCode: 403, publicMessage: 'policy status update denied' })
}

export function createPolicyStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.policyRepository ?? createAdministrativePolicyRepository(options)
    const updated = await updateAdministrativePolicyStatus({ id: body.id, tenantContext, policyStatus: body.policyStatus }, { repository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'policy-status-update', status: updated.status }), updated, automaticEnforcement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'policy-status-update', ...options })
}

export const handler = createPolicyStatusUpdateHandler()
