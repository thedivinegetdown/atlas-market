import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseCandidateManifestRepository, supersedeReleaseCandidate } from '../../lib/system/releaseCandidatePackagingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release candidate action denied', { statusCode: 403, publicMessage: 'release candidate action denied' })
}

export function createReleaseCandidateActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.releaseCandidateManifestRepository ?? createReleaseCandidateManifestRepository(options)
    const result = supersedeReleaseCandidate({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
    const saved = await repository.create?.(result.releaseCandidateManifest)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-candidate-action', status: result.manifestState }), releaseCandidateAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-candidate-action', ...options })
}

export const handler = createReleaseCandidateActionHandler()
