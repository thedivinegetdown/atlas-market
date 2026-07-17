import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseDocumentationRepository, transitionReleaseDocumentation } from '../../lib/system/releaseDocumentationEngine.js'
import { assertAllowedEnum, evaluateSensitiveAction, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, action) {
  if (action === 'validate' && ['owner', 'admin', 'analyst'].includes(membership?.role)) return
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release documentation action denied', { statusCode: 403, publicMessage: 'release documentation action denied' })
}

export function createReleaseDocumentationActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    const action = assertAllowedEnum(body.action ?? 'validate', ['validate', 'publish', 'supersede'], 'action')
    assertAccess(membership, action)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    if (['publish', 'supersede'].includes(action)) evaluateSensitiveAction({ tenantContext, membership, accountId, action: `release-documentation-${action}`, allowedRoles: ['owner', 'admin'] })
    const repository = options.releaseDocumentationRepository ?? createReleaseDocumentationRepository(options)
    const result = transitionReleaseDocumentation({ ...body, action, tenantContext, accountId }, { emitEvent: false })
    if (result.validTransition === false) {
      throw new AppError('invalid_transition', result.releaseDocumentation.blockedReason ?? 'invalid transition', { statusCode: 409, publicMessage: 'invalid transition' })
    }
    const saved = await repository.create?.(result.releaseDocumentation)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-documentation-action', status: result.documentationState }), releaseDocumentationAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-documentation-action', ...options })
}

export const handler = createReleaseDocumentationActionHandler()
