import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseHandoffRepository, evaluateReleaseHandoff } from '../../lib/system/releaseDocumentationEngine.js'
import { evaluateSensitiveAction, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release handoff access denied', { statusCode: 403, publicMessage: 'release handoff access denied' })
}

export function createReleaseHandoffHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseHandoffRepository ?? createReleaseHandoffRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      evaluateSensitiveAction({ tenantContext, membership, accountId, action: 'release-handoff-evaluate', allowedRoles: ['owner', 'admin'] })
      const result = evaluateReleaseHandoff({ ...options, ...body, tenantContext, accountId }, { emitEvent: false, signingSecret: options.releaseSigningSecret })
      const saved = await repository.create?.(result.releaseHandoffEvaluation)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-handoff', status: result.handoffState }), releaseHandoff: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const evaluations = await repository.list?.({ tenantContext, accountId, releaseCandidateId: query.releaseCandidateId, handoffState: query.handoffState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-handoff', status: 'ok' }), releaseHandoffEvaluations: evaluations, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-handoff', maxRequestBytes: 256 * 1024, ...options })
}

export const handler = createReleaseHandoffHandler()
