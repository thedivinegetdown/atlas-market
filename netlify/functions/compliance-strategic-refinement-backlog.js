import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicRefinementBacklogRepository, prioritizeComplianceStrategicRefinementBacklog } from '../../lib/system/complianceStrategicRefinementBacklogEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic refinement access denied', { statusCode: 403, publicMessage: 'compliance strategic refinement access denied' })
}

export function createComplianceStrategicRefinementBacklogHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicRefinementBacklogRepository ?? createComplianceStrategicRefinementBacklogRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.refinement, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-refinement-backlog', status: response.ok ? 'prioritized' : 'blocked' }), refinement: response.refinement, automaticRefinement: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, refinementStatus: query.refinementStatus, limit: query.limit }) ?? []
    const complianceStrategicRefinementBacklog = prioritizeComplianceStrategicRefinementBacklog({ tenantContext, complianceStrategicRefinementBacklog: existing, complianceStrategicFeedbackIntake: options.complianceStrategicFeedbackIntake, complianceStrategicCommunicationEffectiveness: options.complianceStrategicCommunicationEffectiveness, operatorActionCenter: options.operatorActionCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-refinement-backlog', status: complianceStrategicRefinementBacklog.strategicRefinementStatus }), complianceStrategicRefinementBacklog, automaticRefinement: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-refinement-backlog', ...options })
}

export const handler = createComplianceStrategicRefinementBacklogHandler()
