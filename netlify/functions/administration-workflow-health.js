import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateTenantAdministrationWorkflow } from '../../lib/system/tenantAdministrationWorkflowEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administration workflow health access denied', {
      statusCode: 403,
      publicMessage: 'administration workflow health access denied',
    })
  }
}

export function createAdministrationWorkflowHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const workflow = await evaluateTenantAdministrationWorkflow({
      tenantContext,
      existingWorkflows: options.existingWorkflows,
      accessReview: options.accessReview,
      accessCertification: options.accessCertification,
      tenantOperationsHealth: options.tenantOperationsHealth,
      notifications: options.notifications,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'administration-workflow-health', status: workflow.status }),
      health: {
        status: workflow.status,
        workflowCount: workflow.workflowSummary.total,
        open: workflow.workflowSummary.open,
        highPriority: workflow.workflowSummary.highPriority,
        humanReviewOnly: true,
      },
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'administration-workflow-health',
    ...options,
  })
}

export const handler = createAdministrationWorkflowHealthHandler()
