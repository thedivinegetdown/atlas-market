import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { assessComplianceChangeImpact, createComplianceChangeImpactAssessmentRepository } from '../../lib/system/complianceChangeImpactAssessmentEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance change impact assessment access denied', { statusCode: 403, publicMessage: 'compliance change impact assessment access denied' })
}

export function createComplianceChangeImpactAssessmentsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceChangeImpactAssessmentRepository ?? createComplianceChangeImpactAssessmentRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.assessment, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-change-impact-assessments', status: response.ok ? 'assessed' : 'blocked' }), assessment: response.assessment, automaticPolicyUpdate: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, impactStatus: query.impactStatus, limit: query.limit }) ?? []
    const complianceChangeImpactAssessment = assessComplianceChangeImpact({ tenantContext, complianceChangeImpactAssessments: existing, complianceRegulatoryChangeIntake: options.complianceRegulatoryChangeIntake, complianceObligationMapping: options.complianceObligationMapping }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-change-impact-assessments', status: complianceChangeImpactAssessment.changeImpactAssessmentStatus }), complianceChangeImpactAssessment, automaticPolicyUpdate: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-change-impact-assessments', ...options })
}

export const handler = createComplianceChangeImpactAssessmentsHandler()
