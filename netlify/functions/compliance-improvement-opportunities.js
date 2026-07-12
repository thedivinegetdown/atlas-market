import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceImprovementOpportunityRepository, identifyComplianceImprovementOpportunities } from '../../lib/system/complianceImprovementOpportunityEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance improvement opportunity access denied', { statusCode: 403, publicMessage: 'compliance improvement opportunity access denied' })
}

export function createComplianceImprovementOpportunitiesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceImprovementOpportunityRepository ?? createComplianceImprovementOpportunityRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.opportunity, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-improvement-opportunities', status: response.ok ? 'identified' : 'blocked' }), opportunity: response.opportunity, automaticRemediation: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, opportunityStatus: query.opportunityStatus, limit: query.limit }) ?? []
    const complianceImprovementOpportunity = identifyComplianceImprovementOpportunities({ tenantContext, complianceImprovementOpportunities: existing, complianceLessonsLearned: options.complianceLessonsLearned, complianceChangeGovernanceSummary: options.complianceChangeGovernanceSummary }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-improvement-opportunities', status: complianceImprovementOpportunity.improvementOpportunityStatus }), complianceImprovementOpportunity, automaticRemediation: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-improvement-opportunities', ...options })
}

export const handler = createComplianceImprovementOpportunitiesHandler()
