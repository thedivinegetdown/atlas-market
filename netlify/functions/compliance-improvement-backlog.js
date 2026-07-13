import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceImprovementBacklogRepository, prioritizeComplianceImprovementBacklog } from '../../lib/system/complianceImprovementBacklogEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance improvement backlog access denied', { statusCode: 403, publicMessage: 'compliance improvement backlog access denied' })
}

export function createComplianceImprovementBacklogHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceImprovementBacklogRepository ?? createComplianceImprovementBacklogRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.item, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-improvement-backlog', status: response.ok ? 'prioritized' : 'blocked' }), item: response.item, automaticPrioritizationExecution: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, backlogStatus: query.backlogStatus, backlogPriority: query.backlogPriority, limit: query.limit }) ?? []
    const complianceImprovementBacklog = prioritizeComplianceImprovementBacklog({ tenantContext, complianceImprovementBacklogItems: existing, complianceImprovementOpportunity: options.complianceImprovementOpportunity, complianceAdoptionReadiness: options.complianceAdoptionReadiness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-improvement-backlog', status: complianceImprovementBacklog.improvementBacklogStatus }), complianceImprovementBacklog, automaticPrioritizationExecution: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-improvement-backlog', ...options })
}

export const handler = createComplianceImprovementBacklogHandler()
