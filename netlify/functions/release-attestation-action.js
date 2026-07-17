import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseAttestationRepository, revokeReleaseAttestation, signReleaseAttestation, supersedeReleaseAttestation } from '../../lib/system/releaseAttestationGateEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release attestation action denied', { statusCode: 403, publicMessage: 'release attestation action denied' })
}

export function createReleaseAttestationActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.releaseAttestationRepository ?? createReleaseAttestationRepository(options)
    const actor = { id: tenantContext.userId, role: membership.role }
    const action = body.action ?? 'sign'
    const result = action === 'revoke'
      ? revokeReleaseAttestation({ ...options, ...body, tenantContext, actor, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      : action === 'supersede'
        ? supersedeReleaseAttestation({ ...options, ...body, tenantContext, actor, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
        : signReleaseAttestation({ ...options, ...body, tenantContext, actor, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false, signingSecret: options.releaseSigningSecret ?? body.signingSecret })
    const saved = await repository.create?.(result.releaseAttestation)
    await repository.appendActivity?.(result.releaseAttestationActivity)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-attestation-action', status: result.releaseAttestation.attestationState }), releaseAttestationAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-attestation-action', ...options })
}

export const handler = createReleaseAttestationActionHandler()
