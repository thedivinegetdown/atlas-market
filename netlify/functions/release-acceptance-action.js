import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { cancelReleaseAcceptanceRun, createReleaseAcceptanceRepository } from '../../lib/system/releaseAcceptanceEngine.js'
import { assertAllowedEnum, evaluateSensitiveAction, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release acceptance action denied', { statusCode: 403, publicMessage: 'release acceptance action denied' })
}

export function createReleaseAcceptanceActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    const action = assertAllowedEnum(body.action ?? 'cancel', ['cancel'], 'action')
    evaluateSensitiveAction({ tenantContext, membership, accountId, action: `release-acceptance-${action}`, allowedRoles: ['owner', 'admin'] })
    const repository = options.releaseAcceptanceRepository ?? createReleaseAcceptanceRepository(options)
    const result = cancelReleaseAcceptanceRun({ ...body, tenantContext, accountId }, { emitEvent: false })
    if (result.validTransition === false) {
      throw new AppError('invalid_transition', result.releaseAcceptanceRun.blockedReason ?? 'invalid transition', { statusCode: 409, publicMessage: 'invalid transition' })
    }
    const saved = await repository.create?.(result.releaseAcceptanceRun)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-acceptance-action', status: result.releaseAcceptanceRun.runState }), releaseAcceptanceAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-acceptance-action', ...options })
}

export const handler = createReleaseAcceptanceActionHandler()
