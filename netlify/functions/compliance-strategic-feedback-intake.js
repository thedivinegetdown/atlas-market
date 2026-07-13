import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicFeedbackIntakeRepository, evaluateComplianceStrategicFeedbackIntake } from '../../lib/system/complianceStrategicFeedbackIntakeEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic feedback access denied', { statusCode: 403, publicMessage: 'compliance strategic feedback access denied' })
}

export function createComplianceStrategicFeedbackIntakeHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicFeedbackIntakeRepository ?? createComplianceStrategicFeedbackIntakeRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.feedback, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-feedback-intake', status: response.ok ? 'evaluated' : 'blocked' }), feedback: response.feedback, automaticFeedbackCollection: false, automaticEscalation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, feedbackStatus: query.feedbackStatus, limit: query.limit }) ?? []
    const complianceStrategicFeedbackIntake = evaluateComplianceStrategicFeedbackIntake({ tenantContext, complianceStrategicFeedbackIntake: existing, complianceStrategicCommunicationPlan: options.complianceStrategicCommunicationPlan, complianceStrategicStakeholderAlignment: options.complianceStrategicStakeholderAlignment, operatorActionCenter: options.operatorActionCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-feedback-intake', status: complianceStrategicFeedbackIntake.strategicFeedbackStatus }), complianceStrategicFeedbackIntake, automaticFeedbackCollection: false, automaticEscalation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-feedback-intake', ...options })
}

export const handler = createComplianceStrategicFeedbackIntakeHandler()
