import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRemediationPlanRepository } from '../../lib/system/remediationPlanningEngine.js'
import { sanitizeId, apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'remediation plan detail access denied', { statusCode: 403, publicMessage: 'remediation plan detail access denied' })
}

export function createRemediationPlanDetailHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.remediationRepository ?? createRemediationPlanRepository(options)
    const plan = await repository.get?.({ id: sanitizeId(query.id, 'plan id'), tenantContext })
    return { event: apiFoundationEvent({ requestId, endpoint: 'remediation-plan-detail', status: plan ? 'ready' : 'caution' }), plan, sensitiveMaterialExcluded: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'remediation-plan-detail', ...options })
}

export const handler = createRemediationPlanDetailHandler()
