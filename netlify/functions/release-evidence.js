import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseEvidenceRepository, registerReleaseEvidence } from '../../lib/system/releaseEvidenceRegistryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release evidence access denied', { statusCode: 403, publicMessage: 'release evidence access denied' })
}

export function createReleaseEvidenceHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseEvidenceRepository ?? createReleaseEvidenceRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = registerReleaseEvidence({ ...options, ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.releaseEvidence)
      await repository.appendActivity?.(result.releaseEvidenceActivity)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-evidence', status: result.releaseEvidence.verificationState }), releaseEvidence: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const evidence = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, releaseCandidateId: query.releaseCandidateId, verificationState: query.verificationState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-evidence', status: 'ok' }), releaseEvidence: evidence, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-evidence', ...options })
}

export const handler = createReleaseEvidenceHandler()
