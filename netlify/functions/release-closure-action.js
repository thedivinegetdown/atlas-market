import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseClosureRepository, transitionReleaseClosure } from '../../lib/system/releaseClosureMergeReadinessEngine.js'
import { assertAllowedEnum, evaluateSensitiveAction, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release closure action denied', { statusCode: 403, publicMessage: 'release closure action denied' })
}

export function createReleaseClosureActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const action = assertAllowedEnum(body.action ?? 'close', ['close', 'revoke', 'supersede'], 'action')
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    evaluateSensitiveAction({ tenantContext, membership, accountId, action: `release-closure-${action}`, allowedRoles: ['owner', 'admin'] })
    const repository = options.releaseClosureRepository ?? createReleaseClosureRepository(options)
    const actor = { id: tenantContext.userId, role: membership.role }
    const result = transitionReleaseClosure({ ...options, ...body, tenantContext, actor, accountId }, { emitEvent: false, signingSecret: options.releaseSigningSecret })
    if (result.validTransition === false) {
      throw new AppError('invalid_transition', result.releaseClosure.blockedReason ?? 'invalid transition', { statusCode: 409, publicMessage: 'invalid transition' })
    }
    const saved = await repository.create?.(result.releaseClosure)
    await repository.appendActivity?.(result.releaseClosureActivity)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-closure-action', status: result.releaseClosure.closureState }), releaseClosureAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-closure-action', maxRequestBytes: 256 * 1024, ...options })
}

export const handler = createReleaseClosureActionHandler()
