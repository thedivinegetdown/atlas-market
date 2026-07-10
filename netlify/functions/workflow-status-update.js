import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { updateTenantAdministrationWorkflowStatus } from '../../lib/system/tenantAdministrationWorkflowEngine.js'
import { sanitizeId } from './_shared/persistenceApi.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'workflow status update denied', {
      statusCode: 403,
      publicMessage: 'workflow status update denied',
    })
  }
}

export function createWorkflowStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const update = await updateTenantAdministrationWorkflowStatus({
      id: sanitizeId(body.id, 'workflow id'),
      status: body.status,
      tenantContext,
    }, {
      ...options,
      emitEvent: false,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'workflow-status-update', status: update.status }),
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
    routeId: 'workflow-status-update',
    ...options,
  })
}

export const handler = createWorkflowStatusUpdateHandler()
