import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceEscalationPlanRepository, planComplianceEscalations } from '../../lib/system/complianceEscalationPlanningEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance escalation access denied', { statusCode: 403, publicMessage: 'compliance escalation access denied' })
}

export function createComplianceEscalationPlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceEscalationPlanRepository ?? createComplianceEscalationPlanRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.escalationPlan, tenantContext, plannedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-escalation-plans', status: response.ok ? 'planned' : 'blocked' }), escalationPlan: response.plan, automaticEscalationExecution: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, escalationStatus: query.escalationStatus, limit: query.limit }) ?? []
    const complianceEscalationPlanning = planComplianceEscalations({ tenantContext, complianceEscalationPlans: existing, complianceReviewSla: options.complianceReviewSla, complianceReviewFindingTracker: options.complianceReviewFindingTracker, complianceEvidenceRequestQueue: options.complianceEvidenceRequestQueue }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-escalation-plans', status: complianceEscalationPlanning.escalationStatus }), complianceEscalationPlanning, automaticEscalationExecution: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-escalation-plans', ...options })
}

export const handler = createComplianceEscalationPlansHandler()
