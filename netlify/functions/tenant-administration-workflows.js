import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createTenantAdministrationWorkflowRepository, evaluateTenantAdministrationWorkflow } from '../../lib/system/tenantAdministrationWorkflowEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'tenant workflow access denied', {
      statusCode: 403,
      publicMessage: 'tenant workflow access denied',
    })
  }
}

export function createTenantAdministrationWorkflowsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const workflowRepository = options.workflowRepository ?? createTenantAdministrationWorkflowRepository(options)
    const existingWorkflows = await workflowRepository.list?.({ tenantContext, status: query.status, limit: query.limit }) ?? []
    const workflow = await evaluateTenantAdministrationWorkflow({
      tenantContext,
      existingWorkflows,
      accessReview: options.accessReview,
      accessCertification: options.accessCertification,
      collaborationGovernance: options.collaborationGovernance,
      tenantOperationsHealth: options.tenantOperationsHealth,
      notifications: options.notifications,
      operatorActions: options.operatorActions,
    }, {
      repository: workflowRepository,
      emitEvent: false,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'tenant-administration-workflows', status: workflow.status }),
      workflow,
      humanReviewOnly: true,
      destructiveActions: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'tenant-administration-workflows',
    ...options,
  })
}

export const handler = createTenantAdministrationWorkflowsHandler()
