import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicKnowledgeBaseRepository, updateComplianceStrategicKnowledgeBase } from '../../lib/system/complianceStrategicKnowledgeBaseEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic knowledge access denied', { statusCode: 403, publicMessage: 'compliance strategic knowledge access denied' })
}

export function createComplianceStrategicKnowledgeBaseHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicKnowledgeBaseRepository ?? createComplianceStrategicKnowledgeBaseRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.knowledge, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-knowledge-base', status: response.ok ? 'updated' : 'blocked' }), knowledge: response.knowledge, automaticKnowledgeClaim: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, knowledgeStatus: query.knowledgeStatus, limit: query.limit }) ?? []
    const complianceStrategicKnowledgeBase = updateComplianceStrategicKnowledgeBase({ tenantContext, complianceStrategicKnowledgeBase: existing, complianceStrategicLearningSummary: options.complianceStrategicLearningSummary, complianceStrategicOutcomeReview: options.complianceStrategicOutcomeReview, complianceLessonsLearned: options.complianceLessonsLearned }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-knowledge-base', status: complianceStrategicKnowledgeBase.strategicKnowledgeStatus }), complianceStrategicKnowledgeBase, automaticKnowledgeClaim: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-knowledge-base', ...options })
}

export const handler = createComplianceStrategicKnowledgeBaseHandler()
