import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createMergeReadinessRepository, evaluateMergeReadiness } from '../../lib/system/releaseClosureMergeReadinessEngine.js'
import { evaluateSensitiveAction, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Merge readiness access denied', { statusCode: 403, publicMessage: 'merge readiness access denied' })
}

export function createMergeReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.mergeReadinessRepository ?? createMergeReadinessRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      evaluateSensitiveAction({ tenantContext, membership, accountId, action: 'merge-readiness-evaluate', allowedRoles: ['owner', 'admin'] })
      const result = evaluateMergeReadiness({ ...options, ...body, tenantContext, accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.mergeReadinessSnapshot)
      return { event: apiFoundationEvent({ requestId, endpoint: 'merge-readiness', status: result.mergeRecommendation }), mergeReadiness: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const snapshots = await repository.list?.({ tenantContext, accountId, releaseCandidateId: query.releaseCandidateId, mergeRecommendation: query.mergeRecommendation, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'merge-readiness', status: 'ok' }), mergeReadinessSnapshots: snapshots, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'merge-readiness', maxRequestBytes: 256 * 1024, ...options })
}

export const handler = createMergeReadinessHandler()
