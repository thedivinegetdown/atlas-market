import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportArtifactRepository, expirePaperReportArtifact } from '../../lib/reports/paperReportArtifactEngine.js'
import { assertObjectTenantAccess, evaluateSensitiveAction, normalizeSafeId, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report artifact expiration denied', { statusCode: 403, publicMessage: 'paper report artifact expiration denied' })
}

export function createPaperReportArtifactExpirationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.paperReportArtifactRepository ?? createPaperReportArtifactRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    evaluateSensitiveAction({ tenantContext, membership, accountId, action: 'expire-report-artifact', allowedRoles: ['owner', 'admin', 'analyst'] })
    const artifact = body.artifactRecord ?? await repository.get?.({ tenantContext, artifactId: normalizeSafeId(body.artifactId ?? query.artifactId, 'artifactId') })
    if (!artifact) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Artifact is unavailable', { statusCode: 404, publicMessage: 'artifact unavailable' })
    }
    assertObjectTenantAccess(artifact, tenantContext, { accountId, fieldName: 'artifact' })
    const expired = expirePaperReportArtifact(artifact, { emitEvent: false, timestamp: body.timestamp })
    const saved = await repository.update?.(expired.artifactRecord)
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-artifact-expiration', status: expired.artifactStatus }), paperReportArtifactExpiration: { ...expired, artifactRecord: undefined, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-artifact-expiration', ...options })
}

export const handler = createPaperReportArtifactExpirationHandler()
