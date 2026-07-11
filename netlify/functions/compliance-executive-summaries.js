import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceExecutiveSummaryRepository, prepareComplianceExecutiveSummary } from '../../lib/system/complianceExecutiveSummaryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance executive summary access denied', { statusCode: 403, publicMessage: 'compliance executive summary access denied' })
}

export function createComplianceExecutiveSummariesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceExecutiveSummaryRepository ?? createComplianceExecutiveSummaryRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.summary, tenantContext, preparedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-executive-summaries', status: response.ok ? 'prepared' : 'blocked' }), summary: response.summary, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, summaryStatus: query.summaryStatus, limit: query.limit }) ?? []
    const complianceExecutiveSummary = prepareComplianceExecutiveSummary({ tenantContext, complianceExecutiveSummaries: existing, complianceMetricsSnapshot: options.complianceMetricsSnapshot, complianceProgramHealth: options.complianceProgramHealth, complianceBoardPacket: options.complianceBoardPacket }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-executive-summaries', status: complianceExecutiveSummary.executiveSummaryStatus }), complianceExecutiveSummary, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-executive-summaries', ...options })
}

export const handler = createComplianceExecutiveSummariesHandler()
