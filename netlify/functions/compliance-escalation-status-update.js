import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceEscalationPlanRepository, updateComplianceEscalationStatus } from '../../lib/system/complianceEscalationPlanningEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance escalation status update denied', { statusCode: 403, publicMessage: 'compliance escalation status update denied' })
}

export function createComplianceEscalationStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceEscalationPlanRepository ?? createComplianceEscalationPlanRepository(options)
    const updated = await updateComplianceEscalationStatus({ id: body.id, tenantContext, escalationStatus: body.escalationStatus }, { repository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-escalation-status-update', status: updated.status }), updated, automaticEscalationExecution: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-escalation-status-update', ...options })
}

export const handler = createComplianceEscalationStatusUpdateHandler()
