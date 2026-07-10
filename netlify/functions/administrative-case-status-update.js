import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAdministrativeCaseRepository, updateAdministrativeCaseStatus } from '../../lib/system/administrativeCaseManagementEngine.js'
import { sanitizeId, apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative case update denied', {
      statusCode: 403,
      publicMessage: 'administrative case update denied',
    })
  }
}

export function createAdministrativeCaseStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.caseRepository ?? createAdministrativeCaseRepository(options)
    const update = await updateAdministrativeCaseStatus({
      id: sanitizeId(body.id, 'case id'),
      tenantContext,
      status: body.status,
      resolutionSummary: body.resolutionSummary,
    }, { repository, emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'administrative-case-status-update', status: update.status }),
      update,
      humanReviewOnly: true,
      automaticDestructiveActions: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'administrative-case-status-update',
    ...options,
  })
}

export const handler = createAdministrativeCaseStatusUpdateHandler()
