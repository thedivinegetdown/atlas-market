import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicAdaptationReadinessRepository, evaluateComplianceStrategicAdaptationReadiness } from '../../lib/system/complianceStrategicAdaptationReadinessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic adaptation access denied', { statusCode: 403, publicMessage: 'compliance strategic adaptation access denied' })
}

export function createComplianceStrategicAdaptationReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicAdaptationReadinessRepository ?? createComplianceStrategicAdaptationReadinessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.adaptation, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-adaptation-readiness', status: response.ok ? 'evaluated' : 'blocked' }), adaptation: response.adaptation, automaticAdaptation: false, automaticStrategyChange: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, adaptationStatus: query.adaptationStatus, limit: query.limit }) ?? []
    const complianceStrategicAdaptationReadiness = evaluateComplianceStrategicAdaptationReadiness({ tenantContext, complianceStrategicAdaptationReadiness: existing, complianceStrategicRefinementBacklog: options.complianceStrategicRefinementBacklog, complianceStrategicCommunicationEffectiveness: options.complianceStrategicCommunicationEffectiveness, complianceExecutiveStrategyPlan: options.complianceExecutiveStrategyPlan }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-adaptation-readiness', status: complianceStrategicAdaptationReadiness.strategicAdaptationStatus }), complianceStrategicAdaptationReadiness, automaticAdaptation: false, automaticStrategyChange: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-adaptation-readiness', ...options })
}

export const handler = createComplianceStrategicAdaptationReadinessHandler()
