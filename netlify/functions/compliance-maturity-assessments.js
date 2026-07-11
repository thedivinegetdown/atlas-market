import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { assessComplianceMaturity, createComplianceMaturityAssessmentRepository } from '../../lib/system/complianceMaturityAssessmentEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance maturity assessment access denied', { statusCode: 403, publicMessage: 'compliance maturity assessment access denied' })
}

export function createComplianceMaturityAssessmentsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceMaturityAssessmentRepository ?? createComplianceMaturityAssessmentRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.assessment, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-maturity-assessments', status: response.ok ? 'assessed' : 'blocked' }), assessment: response.assessment, automaticApproval: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, maturityLevel: query.maturityLevel, limit: query.limit }) ?? []
    const complianceMaturityAssessment = assessComplianceMaturity({ tenantContext, complianceMaturityAssessments: existing, complianceExecutiveDashboard: options.complianceExecutiveDashboard, complianceTrendAnalytics: options.complianceTrendAnalytics, complianceRiskForecast: options.complianceRiskForecast }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-maturity-assessments', status: complianceMaturityAssessment.maturityAssessmentStatus }), complianceMaturityAssessment, automaticApproval: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-maturity-assessments', ...options })
}

export const handler = createComplianceMaturityAssessmentsHandler()
