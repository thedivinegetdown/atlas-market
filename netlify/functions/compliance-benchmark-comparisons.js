import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceBenchmarkComparisonRepository, evaluateComplianceBenchmarkComparison } from '../../lib/system/complianceBenchmarkComparisonEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance benchmark comparison access denied', { statusCode: 403, publicMessage: 'compliance benchmark comparison access denied' })
}

export function createComplianceBenchmarkComparisonsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceBenchmarkComparisonRepository ?? createComplianceBenchmarkComparisonRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.comparison, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-benchmark-comparisons', status: response.ok ? 'evaluated' : 'blocked' }), comparison: response.comparison, automaticApproval: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, benchmarkStatus: query.benchmarkStatus, limit: query.limit }) ?? []
    const complianceBenchmarkComparison = evaluateComplianceBenchmarkComparison({ tenantContext, complianceBenchmarkComparisons: existing, complianceMaturityAssessment: options.complianceMaturityAssessment, complianceTrendAnalytics: options.complianceTrendAnalytics }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-benchmark-comparisons', status: complianceBenchmarkComparison.benchmarkComparisonStatus }), complianceBenchmarkComparison, automaticApproval: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-benchmark-comparisons', ...options })
}

export const handler = createComplianceBenchmarkComparisonsHandler()
