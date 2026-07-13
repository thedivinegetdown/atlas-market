import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicLearningSummaryRepository, captureComplianceStrategicLearningSummary } from '../../lib/system/complianceStrategicLearningSummaryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic learning access denied', { statusCode: 403, publicMessage: 'compliance strategic learning access denied' })
}

export function createComplianceStrategicLearningSummariesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicLearningSummaryRepository ?? createComplianceStrategicLearningSummaryRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.learning, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-learning-summaries', status: response.ok ? 'captured' : 'blocked' }), learning: response.learning, automaticLearningClaim: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, learningStatus: query.learningStatus, limit: query.limit }) ?? []
    const complianceStrategicLearningSummary = captureComplianceStrategicLearningSummary({ tenantContext, complianceStrategicLearningSummaries: existing, complianceStrategicOutcomeReview: options.complianceStrategicOutcomeReview, complianceStrategicAdaptationReadiness: options.complianceStrategicAdaptationReadiness, complianceStrategicFeedbackIntake: options.complianceStrategicFeedbackIntake }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-learning-summaries', status: complianceStrategicLearningSummary.strategicLearningStatus }), complianceStrategicLearningSummary, automaticLearningClaim: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-learning-summaries', ...options })
}

export const handler = createComplianceStrategicLearningSummariesHandler()
