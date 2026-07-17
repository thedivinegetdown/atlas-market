import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseEvidenceRepository, supersedeReleaseEvidence, updateReleaseEvidenceVerification } from '../../lib/system/releaseEvidenceRegistryEngine.js'
import { assertAllowedEnum, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release evidence action denied', { statusCode: 403, publicMessage: 'release evidence action denied' })
}

export function createReleaseEvidenceActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.releaseEvidenceRepository ?? createReleaseEvidenceRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    const actor = { id: tenantContext.userId, role: membership.role }
    const action = assertAllowedEnum(body.action ?? body.verificationState ?? 'verified', ['verified', 'reject', 'rejected', 'expire', 'expired', 'supersede', 'superseded'], 'action')
    const result = action === 'supersede' || action === 'superseded'
      ? supersedeReleaseEvidence({ ...options, ...body, tenantContext, actor, accountId }, { emitEvent: false })
      : updateReleaseEvidenceVerification({ ...options, ...body, action, tenantContext, actor, accountId }, { emitEvent: false })
    const saved = await repository.create?.(result.releaseEvidence)
    await repository.appendActivity?.(result.releaseEvidenceActivity)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-evidence-action', status: result.releaseEvidence.verificationState }), releaseEvidenceAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-evidence-action', ...options })
}

export const handler = createReleaseEvidenceActionHandler()
