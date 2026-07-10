import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAdministrativeEvidenceRepository } from '../../lib/system/administrativeEvidenceEngine.js'
import { sanitizeId, apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative evidence detail access denied', { statusCode: 403, publicMessage: 'administrative evidence detail access denied' })
}

export function createAdministrativeEvidenceDetailHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.evidenceRepository ?? createAdministrativeEvidenceRepository(options)
    const evidence = await repository.get?.({ id: sanitizeId(query.id, 'evidence id'), tenantContext })
    return { event: apiFoundationEvent({ requestId, endpoint: 'administrative-evidence-detail', status: evidence ? 'ready' : 'caution' }), evidence, sensitiveMaterialExcluded: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'administrative-evidence-detail', ...options })
}

export const handler = createAdministrativeEvidenceDetailHandler()
