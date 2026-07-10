import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPolicyExceptionRepository, normalizePolicyException } from '../../lib/system/controlAssuranceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'policy exception access denied', { statusCode: 403, publicMessage: 'policy exception access denied' })
}

export function createPolicyExceptionsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.policyExceptionRepository ?? createPolicyExceptionRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.exception, tenantContext, exceptionOwnerUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'policy-exceptions', status: response.ok ? 'created' : 'blocked' }), exception: response.exception, automaticExceptionApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const exceptions = await repository.list?.({ tenantContext, exceptionStatus: query.exceptionStatus, limit: query.limit }) ?? (options.policyExceptions ?? []).map(normalizePolicyException)
    return { event: apiFoundationEvent({ requestId, endpoint: 'policy-exceptions', status: 'ready' }), exceptions, pagination: { limit: Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50)), returned: exceptions.length }, automaticExceptionApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'policy-exceptions', ...options })
}

export const handler = createPolicyExceptionsHandler()
