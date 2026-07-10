import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRemediationEffectivenessRepository, evaluateRemediationEffectiveness } from '../../lib/system/remediationEffectivenessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'remediation effectiveness access denied', { statusCode: 403, publicMessage: 'remediation effectiveness access denied' })
}

export function createRemediationEffectivenessReviewHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.remediationEffectivenessRepository ?? createRemediationEffectivenessRepository(options)
    const existing = await repository.list?.({ tenantContext, effectivenessRating: query.effectivenessRating, limit: query.limit }) ?? []
    const effectiveness = evaluateRemediationEffectiveness({ tenantContext, remediationPlanning: options.remediationPlanning, administrativeEvidence: options.administrativeEvidence, administrativeCases: options.administrativeCases, operatorAttention: options.operatorAttention, administrationWorkflowSla: options.administrationWorkflowSla, remediationPlans: existing }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'remediation-effectiveness-review', status: effectiveness.status }), effectiveness, recommendationsOnly: true, dashboardExecution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'remediation-effectiveness-review', ...options })
}

export const handler = createRemediationEffectivenessReviewHandler()
