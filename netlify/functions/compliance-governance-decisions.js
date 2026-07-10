import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceGovernanceDecisionRepository, recordComplianceGovernanceDecisions } from '../../lib/system/complianceGovernanceDecisionLogEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance governance decision access denied', { statusCode: 403, publicMessage: 'compliance governance decision access denied' })
}

export function createComplianceGovernanceDecisionsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceGovernanceDecisionRepository ?? createComplianceGovernanceDecisionRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.decision, tenantContext, recordedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-governance-decisions', status: response.ok ? 'recorded' : 'blocked' }), decision: response.decision, automaticApproval: false, automaticEnforcementActions: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, decisionStatus: query.decisionStatus, decisionType: query.decisionType, limit: query.limit }) ?? []
    const complianceGovernanceDecisionLog = recordComplianceGovernanceDecisions({
      tenantContext,
      complianceGovernanceDecisions: existing,
      complianceAuditReadinessPackage: options.complianceAuditReadinessPackage,
      complianceExternalReviewPlanning: options.complianceExternalReviewPlanning,
      complianceGovernanceReadout: options.complianceGovernanceReadout,
      complianceEscalationPlanning: options.complianceEscalationPlanning,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-governance-decisions', status: complianceGovernanceDecisionLog.decisionLogStatus }), complianceGovernanceDecisionLog, automaticApproval: false, automaticEnforcementActions: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-governance-decisions', ...options })
}

export const handler = createComplianceGovernanceDecisionsHandler()
