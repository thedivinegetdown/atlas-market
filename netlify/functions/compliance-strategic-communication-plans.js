import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicCommunicationPlanRepository, prepareComplianceStrategicCommunicationPlan } from '../../lib/system/complianceStrategicCommunicationPlanEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic communication access denied', { statusCode: 403, publicMessage: 'compliance strategic communication access denied' })
}

export function createComplianceStrategicCommunicationPlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicCommunicationPlanRepository ?? createComplianceStrategicCommunicationPlanRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.communication, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-communication-plans', status: response.ok ? 'prepared' : 'blocked' }), communication: response.communication, automaticDistribution: false, automaticMessageApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, communicationStatus: query.communicationStatus, limit: query.limit }) ?? []
    const complianceStrategicCommunicationPlan = prepareComplianceStrategicCommunicationPlan({ tenantContext, complianceStrategicCommunicationPlans: existing, complianceStrategicStakeholderAlignment: options.complianceStrategicStakeholderAlignment, complianceExecutiveStrategyPlan: options.complianceExecutiveStrategyPlan, complianceGovernanceReadout: options.complianceGovernanceReadout }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-communication-plans', status: complianceStrategicCommunicationPlan.strategicCommunicationStatus }), complianceStrategicCommunicationPlan, automaticDistribution: false, automaticMessageApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-communication-plans', ...options })
}

export const handler = createComplianceStrategicCommunicationPlansHandler()
