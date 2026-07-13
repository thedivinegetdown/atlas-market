import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicMilestonePlanRepository, planComplianceStrategicMilestones } from '../../lib/system/complianceStrategicMilestonePlannerEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic milestone access denied', { statusCode: 403, publicMessage: 'compliance strategic milestone access denied' })
}

export function createComplianceStrategicMilestonePlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicMilestonePlanRepository ?? createComplianceStrategicMilestonePlanRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.milestone, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-milestone-plans', status: response.ok ? 'planned' : 'blocked' }), milestone: response.milestone, automaticMilestoneApproval: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, milestoneStatus: query.milestoneStatus, limit: query.limit }) ?? []
    const complianceStrategicMilestones = planComplianceStrategicMilestones({ tenantContext, complianceStrategicMilestonePlans: existing, complianceExecutiveStrategyPlan: options.complianceExecutiveStrategyPlan, complianceImplementationPlanning: options.complianceImplementationPlanning, complianceGovernanceActionItems: options.complianceGovernanceActionItems }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-milestone-plans', status: complianceStrategicMilestones.strategicMilestoneStatus }), complianceStrategicMilestones, automaticMilestoneApproval: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-milestone-plans', ...options })
}

export const handler = createComplianceStrategicMilestonePlansHandler()
