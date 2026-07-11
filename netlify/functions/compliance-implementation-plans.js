import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceImplementationPlanningRepository, prepareComplianceImplementationPlan } from '../../lib/system/complianceImplementationPlanningEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance implementation planning access denied', { statusCode: 403, publicMessage: 'compliance implementation planning access denied' })
}

export function createComplianceImplementationPlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceImplementationPlanningRepository ?? createComplianceImplementationPlanningRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.plan, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-implementation-plans', status: response.ok ? 'prepared' : 'blocked' }), plan: response.plan, automaticImplementation: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, implementationStatus: query.implementationStatus, limit: query.limit }) ?? []
    const complianceImplementationPlanning = prepareComplianceImplementationPlan({ tenantContext, complianceImplementationPlans: existing, complianceChangeImpactAssessment: options.complianceChangeImpactAssessment, complianceResourcePlanning: options.complianceResourcePlanning, complianceContinuityReadiness: options.complianceContinuityReadiness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-implementation-plans', status: complianceImplementationPlanning.implementationPlanningStatus }), complianceImplementationPlanning, automaticImplementation: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-implementation-plans', ...options })
}

export const handler = createComplianceImplementationPlansHandler()
