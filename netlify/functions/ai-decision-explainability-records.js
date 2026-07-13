import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiDecisionExplainabilityRepository, prepareAiDecisionExplainability } from '../../lib/system/aiDecisionExplainabilityEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI decision explainability access denied', { statusCode: 403, publicMessage: 'AI decision explainability access denied' })
}

export function createAiDecisionExplainabilityRecordsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.aiDecisionExplainabilityRepository ?? createAiDecisionExplainabilityRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.explanation, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-decision-explainability-records', status: response.ok ? 'prepared' : 'blocked' }), explanation: response.explanation, automaticExplanationClaim: false, automaticDecisionOverride: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, explainabilityStatus: query.explainabilityStatus, limit: query.limit }) ?? []
    const aiDecisionExplainability = prepareAiDecisionExplainability({ tenantContext, aiDecisionExplainabilityRecords: existing, aiDecisionGovernanceReadiness: options.aiDecisionGovernanceReadiness, aiDecision: options.aiDecision, researchEnhancedDecision: options.researchEnhancedDecision, complianceStrategicKnowledgeBase: options.complianceStrategicKnowledgeBase }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-decision-explainability-records', status: aiDecisionExplainability.aiDecisionExplainabilityStatus }), aiDecisionExplainability, automaticExplanationClaim: false, automaticDecisionOverride: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'ai-decision-explainability-records', ...options })
}

export const handler = createAiDecisionExplainabilityRecordsHandler()
