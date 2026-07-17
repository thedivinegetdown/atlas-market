import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseClosureRepository, evaluateReleaseClosure } from '../../lib/system/releaseClosureMergeReadinessEngine.js'
import { evaluateSensitiveAction, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release closure access denied', { statusCode: 403, publicMessage: 'release closure access denied' })
}

export function createReleaseClosureHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseClosureRepository ?? createReleaseClosureRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      evaluateSensitiveAction({ tenantContext, membership, accountId, action: 'release-closure-evaluate', allowedRoles: ['owner', 'admin'] })
      const result = evaluateReleaseClosure({ ...options, ...body, tenantContext, accountId }, { emitEvent: false, signingSecret: options.releaseSigningSecret })
      const saved = await repository.create?.(result.releaseClosure)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-closure', status: result.closureState }), releaseClosure: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const closures = await repository.list?.({ tenantContext, accountId, releaseCandidateId: query.releaseCandidateId, closureState: query.closureState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-closure', status: 'ok' }), releaseClosures: closures, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-closure', maxRequestBytes: 256 * 1024, ...options })
}

export const handler = createReleaseClosureHandler()
