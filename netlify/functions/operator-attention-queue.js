import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { prioritizeOperatorAttention } from '../../lib/system/operatorAttentionPrioritizationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'operator attention access denied', {
      statusCode: 403,
      publicMessage: 'operator attention access denied',
    })
  }
}

export function createOperatorAttentionQueueHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const attention = prioritizeOperatorAttention({
      tenantContext,
      notificationDigest: options.notificationDigest,
      userActivityRiskReview: options.userActivityRiskReview,
      administrationWorkflowSla: options.administrationWorkflowSla,
      tenantAdministrationWorkflow: options.tenantAdministrationWorkflow,
      accessReview: options.accessReview,
      sessionSecurity: options.sessionSecurity,
      tenantOperationsHealth: options.tenantOperationsHealth,
      administrativeAudit: options.administrativeAudit,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'operator-attention-queue', status: attention.status }),
      attention,
      humanReviewOnly: true,
      automaticDestructiveActions: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'operator-attention-queue',
    ...options,
  })
}

export const handler = createOperatorAttentionQueueHandler()
