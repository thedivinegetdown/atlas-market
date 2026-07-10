import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAdministrativeCaseRepository } from '../../lib/system/administrativeCaseManagementEngine.js'
import { sanitizeId, apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative case detail access denied', {
      statusCode: 403,
      publicMessage: 'administrative case detail access denied',
    })
  }
}

export function createAdministrativeCaseDetailHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.caseRepository ?? createAdministrativeCaseRepository(options)
    const administrativeCase = await repository.get?.({ id: sanitizeId(query.id, 'case id'), tenantContext })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'administrative-case-detail', status: administrativeCase ? 'ready' : 'caution' }),
      administrativeCase,
      sensitiveMaterialExcluded: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'administrative-case-detail',
    ...options,
  })
}

export const handler = createAdministrativeCaseDetailHandler()
