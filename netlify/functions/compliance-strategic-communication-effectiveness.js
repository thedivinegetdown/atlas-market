import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicCommunicationEffectivenessRepository, reviewComplianceStrategicCommunicationEffectiveness } from '../../lib/system/complianceStrategicCommunicationEffectivenessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic communication effectiveness access denied', { statusCode: 403, publicMessage: 'compliance strategic communication effectiveness access denied' })
}

export function createComplianceStrategicCommunicationEffectivenessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicCommunicationEffectivenessRepository ?? createComplianceStrategicCommunicationEffectivenessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.effectiveness, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-communication-effectiveness', status: response.ok ? 'reviewed' : 'blocked' }), effectiveness: response.effectiveness, automaticEffectivenessClaim: false, automaticRemediation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, effectivenessStatus: query.effectivenessStatus, limit: query.limit }) ?? []
    const complianceStrategicCommunicationEffectiveness = reviewComplianceStrategicCommunicationEffectiveness({ tenantContext, complianceStrategicCommunicationEffectiveness: existing, complianceStrategicFeedbackIntake: options.complianceStrategicFeedbackIntake, complianceStrategicCommunicationPlan: options.complianceStrategicCommunicationPlan, complianceStrategicKpis: options.complianceStrategicKpis }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-communication-effectiveness', status: complianceStrategicCommunicationEffectiveness.communicationEffectivenessStatus }), complianceStrategicCommunicationEffectiveness, automaticEffectivenessClaim: false, automaticRemediation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-communication-effectiveness', ...options })
}

export const handler = createComplianceStrategicCommunicationEffectivenessHandler()
