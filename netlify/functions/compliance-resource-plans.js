import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceResourcePlanningRepository, evaluateComplianceResourcePlanning } from '../../lib/system/complianceResourcePlanningEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance resource planning access denied', { statusCode: 403, publicMessage: 'compliance resource planning access denied' })
}

export function createComplianceResourcePlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceResourcePlanningRepository ?? createComplianceResourcePlanningRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.plan, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-resource-plans', status: response.ok ? 'evaluated' : 'blocked' }), plan: response.plan, automaticAssignment: false, automaticBudgetAction: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, resourceStatus: query.resourceStatus, limit: query.limit }) ?? []
    const complianceResourcePlanning = evaluateComplianceResourcePlanning({ tenantContext, complianceResourcePlans: existing, complianceScenarioPlanning: options.complianceScenarioPlanning, complianceGovernanceActionItems: options.complianceGovernanceActionItems }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-resource-plans', status: complianceResourcePlanning.resourcePlanningStatus }), complianceResourcePlanning, automaticAssignment: false, automaticBudgetAction: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-resource-plans', ...options })
}

export const handler = createComplianceResourcePlansHandler()
