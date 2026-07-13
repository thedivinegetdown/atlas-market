import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceExecutiveStrategyPlanRepository, prepareComplianceExecutiveStrategyPlan } from '../../lib/system/complianceExecutiveStrategyPlanEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance executive strategy access denied', { statusCode: 403, publicMessage: 'compliance executive strategy access denied' })
}

export function createComplianceExecutiveStrategyPlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceExecutiveStrategyPlanRepository ?? createComplianceExecutiveStrategyPlanRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.strategy, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-executive-strategy-plans', status: response.ok ? 'prepared' : 'blocked' }), strategy: response.strategy, automaticExecutiveApproval: false, automaticDistribution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, strategyStatus: query.strategyStatus, limit: query.limit }) ?? []
    const complianceExecutiveStrategyPlan = prepareComplianceExecutiveStrategyPlan({ tenantContext, complianceExecutiveStrategyPlans: existing, complianceStrategicInitiativePortfolio: options.complianceStrategicInitiativePortfolio, complianceExecutiveDashboard: options.complianceExecutiveDashboard, complianceGovernanceReadout: options.complianceGovernanceReadout }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-executive-strategy-plans', status: complianceExecutiveStrategyPlan.executiveStrategyStatus }), complianceExecutiveStrategyPlan, automaticExecutiveApproval: false, automaticDistribution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-executive-strategy-plans', ...options })
}

export const handler = createComplianceExecutiveStrategyPlansHandler()
