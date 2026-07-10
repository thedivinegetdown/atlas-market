import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAdministrativePolicyRepository } from '../../lib/system/administrativePolicyGovernanceEngine.js'
import { apiFoundationEvent, sanitizeId } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative policy detail access denied', { statusCode: 403, publicMessage: 'administrative policy detail access denied' })
}

export function createAdministrativePolicyDetailHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.policyRepository ?? createAdministrativePolicyRepository(options)
    const policy = await repository.get?.({ id: sanitizeId(query.id), tenantContext })
    return { event: apiFoundationEvent({ requestId, endpoint: 'administrative-policy-detail', status: policy ? 'found' : 'missing' }), policy, automaticEnforcement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'administrative-policy-detail', ...options })
}

export const handler = createAdministrativePolicyDetailHandler()
