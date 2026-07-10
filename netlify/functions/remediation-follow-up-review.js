import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateRemediationEffectiveness } from '../../lib/system/remediationEffectivenessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'remediation follow-up access denied', { statusCode: 403, publicMessage: 'remediation follow-up access denied' })
}

export function createRemediationFollowUpReviewHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const effectiveness = evaluateRemediationEffectiveness({ tenantContext, remediationPlanning: options.remediationPlanning, administrativeEvidence: options.administrativeEvidence, administrativeCases: options.administrativeCases, operatorAttention: options.operatorAttention, administrationWorkflowSla: options.administrationWorkflowSla }, { emitEvent: false })
    const followUpReviews = effectiveness.remediationEffectivenessEvaluations.filter((item) => item.followUpRequired)
    return { event: apiFoundationEvent({ requestId, endpoint: 'remediation-follow-up-review', status: effectiveness.status }), followUpReviews, followUpSummary: { total: followUpReviews.length, criticalResidualRisk: followUpReviews.filter((item) => item.currentResidualRisk === 'critical').length }, recommendationsOnly: true, automaticEnforcementActions: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'remediation-follow-up-review', ...options })
}

export const handler = createRemediationFollowUpReviewHandler()
