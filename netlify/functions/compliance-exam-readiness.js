import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceExamReadinessRepository, evaluateComplianceExamReadiness } from '../../lib/system/complianceExamReadinessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance exam readiness access denied', { statusCode: 403, publicMessage: 'compliance exam readiness access denied' })
}

export function createComplianceExamReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceExamReadinessRepository ?? createComplianceExamReadinessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.evaluation, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-exam-readiness', status: response.ok ? 'evaluated' : 'blocked' }), evaluation: response.evaluation, automaticSubmission: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, readinessStatus: query.readinessStatus, limit: query.limit }) ?? []
    const complianceExamReadiness = evaluateComplianceExamReadiness({ tenantContext, complianceExamReadinessEvaluations: existing, complianceAuditReadinessPackage: options.complianceAuditReadinessPackage, complianceExternalReviewPlanning: options.complianceExternalReviewPlanning, complianceRecordRetentionReview: options.complianceRecordRetentionReview, complianceRiskCommandCenter: options.complianceRiskCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-exam-readiness', status: complianceExamReadiness.examReadinessStatus }), complianceExamReadiness, automaticSubmission: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-exam-readiness', ...options })
}

export const handler = createComplianceExamReadinessHandler()
