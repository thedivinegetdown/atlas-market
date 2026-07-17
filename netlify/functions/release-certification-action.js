import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseCertificationRepository, supersedeReleaseCertification } from '../../lib/system/releaseCertificationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release certification action denied', { statusCode: 403, publicMessage: 'release certification action denied' })
}

export function createReleaseCertificationActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.releaseCertificationRepository ?? createReleaseCertificationRepository(options)
    const result = supersedeReleaseCertification({ ...options, ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
    const saved = await repository.create?.(result.releaseCertification)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-certification-action', status: result.certificationState }), releaseCertificationAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-certification-action', ...options })
}

export const handler = createReleaseCertificationActionHandler()
