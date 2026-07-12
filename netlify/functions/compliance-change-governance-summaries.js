import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceChangeGovernanceSummaryRepository, summarizeComplianceChangeGovernance } from '../../lib/system/complianceChangeGovernanceSummaryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance change governance summary access denied', { statusCode: 403, publicMessage: 'compliance change governance summary access denied' })
}

export function createComplianceChangeGovernanceSummariesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceChangeGovernanceSummaryRepository ?? createComplianceChangeGovernanceSummaryRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.summary, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-change-governance-summaries', status: response.ok ? 'summarized' : 'blocked' }), summary: response.summary, automaticGovernanceDecision: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, governanceStatus: query.governanceStatus, limit: query.limit }) ?? []
    const complianceChangeGovernanceSummary = summarizeComplianceChangeGovernance({ tenantContext, complianceChangeGovernanceSummaries: existing, complianceLessonsLearned: options.complianceLessonsLearned, complianceGovernanceDecisionLog: options.complianceGovernanceDecisionLog, complianceChangeClosureReadiness: options.complianceChangeClosureReadiness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-change-governance-summaries', status: complianceChangeGovernanceSummary.changeGovernanceSummaryStatus }), complianceChangeGovernanceSummary, automaticGovernanceDecision: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-change-governance-summaries', ...options })
}

export const handler = createComplianceChangeGovernanceSummariesHandler()
