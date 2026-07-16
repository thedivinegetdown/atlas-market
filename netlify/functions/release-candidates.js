import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseCandidateManifest, createReleaseCandidateManifestRepository } from '../../lib/system/releaseCandidatePackagingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release candidate access denied', { statusCode: 403, publicMessage: 'release candidate access denied' })
}

export function createReleaseCandidatesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseCandidateManifestRepository ?? createReleaseCandidateManifestRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const created = createReleaseCandidateManifest({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(created.releaseCandidateManifest)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-candidates', status: created.manifestState }), releaseCandidate: { ...created, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const manifests = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, manifestState: query.manifestState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-candidates', status: 'ok' }), releaseCandidates: manifests, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-candidates', ...options })
}

export const handler = createReleaseCandidatesHandler()
