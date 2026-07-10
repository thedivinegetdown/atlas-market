import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateComplianceRiskCommandCenter } from '../../lib/system/complianceRiskCommandCenterEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance risk health access denied', { statusCode: 403, publicMessage: 'compliance risk health access denied' })
}

export function createComplianceRiskHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership }) => {
    assertOwnerAdmin(membership)
    const commandCenter = evaluateComplianceRiskCommandCenter({
      complianceOperationsCommandCenter: options.complianceOperationsCommandCenter,
      complianceObligationMapping: options.complianceObligationMapping,
      complianceEvidenceRequestQueue: options.complianceEvidenceRequestQueue,
      complianceReviewFindingTracker: options.complianceReviewFindingTracker,
      complianceReviewSla: options.complianceReviewSla,
      complianceEscalationPlanning: options.complianceEscalationPlanning,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-risk-health', status: commandCenter.commandCenterStatus }), commandCenter, automaticComplianceClaims: false, automaticEscalationExecution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-risk-health', ...options })
}

export const handler = createComplianceRiskHealthHandler()
