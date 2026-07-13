import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiDecisionGovernanceReadinessRepository, evaluateAiDecisionGovernanceReadiness } from '../../lib/system/aiDecisionGovernanceReadinessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI decision governance access denied', { statusCode: 403, publicMessage: 'AI decision governance access denied' })
}

export function createAiDecisionGovernanceReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.aiDecisionGovernanceReadinessRepository ?? createAiDecisionGovernanceReadinessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.readiness, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-decision-governance-readiness', status: response.ok ? 'evaluated' : 'blocked' }), readiness: response.readiness, automaticModelApproval: false, automaticDecisionOverride: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, governanceStatus: query.governanceStatus, limit: query.limit }) ?? []
    const aiDecisionGovernanceReadiness = evaluateAiDecisionGovernanceReadiness({ tenantContext, aiDecisionGovernanceReadiness: existing, aiDecision: options.aiDecision, researchEnhancedDecision: options.researchEnhancedDecision, enterpriseReleaseControl: options.enterpriseReleaseControl, enterpriseAuditTrail: options.enterpriseAuditTrail }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-decision-governance-readiness', status: aiDecisionGovernanceReadiness.aiDecisionGovernanceStatus }), aiDecisionGovernanceReadiness, automaticModelApproval: false, automaticDecisionOverride: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'ai-decision-governance-readiness', ...options })
}

export const handler = createAiDecisionGovernanceReadinessHandler()
