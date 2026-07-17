import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateReleaseRecoveryReadiness } from '../../lib/system/releaseRunbookRecoveryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release recovery readiness access denied', { statusCode: 403, publicMessage: 'release recovery readiness access denied' })
}

export function createReleaseRecoveryReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const evaluated = evaluateReleaseRecoveryReadiness({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-recovery-readiness', status: evaluated.recoveryReadinessState }), releaseRecoveryReadiness: evaluated, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-recovery-readiness', ...options })
}

export const handler = createReleaseRecoveryReadinessHandler()
