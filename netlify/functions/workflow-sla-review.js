import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createTenantAdministrationWorkflowRepository, evaluateTenantAdministrationWorkflow } from '../../lib/system/tenantAdministrationWorkflowEngine.js'
import { evaluateAdministrationWorkflowSla } from '../../lib/system/administrationWorkflowSlaEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'workflow SLA access denied', {
      statusCode: 403,
      publicMessage: 'workflow SLA access denied',
    })
  }
}

export function createWorkflowSlaReviewHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const workflowRepository = options.workflowRepository ?? createTenantAdministrationWorkflowRepository(options)
    const existingWorkflows = options.workflows ?? await workflowRepository.list?.({ tenantContext, status: query.status, limit: query.limit }) ?? []
    const tenantAdministrationWorkflow = options.tenantAdministrationWorkflow ?? evaluateTenantAdministrationWorkflow({
      tenantContext,
      existingWorkflows,
      accessReview: options.accessReview,
      accessCertification: options.accessCertification,
      tenantOperationsHealth: options.tenantOperationsHealth,
      notifications: options.notifications,
    }, { emitEvent: false })
    const sla = evaluateAdministrationWorkflowSla({
      tenantAdministrationWorkflow,
      operatorActions: options.operatorActions,
      accessCertification: options.accessCertification,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'workflow-sla-review', status: sla.workflowSlaStatus }),
      sla,
      escalationPlanningOnly: true,
      automaticWorkflowMutation: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'workflow-sla-review',
    ...options,
  })
}

export const handler = createWorkflowSlaReviewHandler()
