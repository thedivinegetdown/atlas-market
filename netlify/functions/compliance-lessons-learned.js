import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { captureComplianceLessonsLearned, createComplianceLessonsLearnedRepository } from '../../lib/system/complianceLessonsLearnedEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance lessons learned access denied', { statusCode: 403, publicMessage: 'compliance lessons learned access denied' })
}

export function createComplianceLessonsLearnedHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceLessonsLearnedRepository ?? createComplianceLessonsLearnedRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.lesson, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-lessons-learned', status: response.ok ? 'captured' : 'blocked' }), lesson: response.lesson, automaticPolicyUpdate: false, automaticTrainingAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, lessonStatus: query.lessonStatus, limit: query.limit }) ?? []
    const complianceLessonsLearned = captureComplianceLessonsLearned({ tenantContext, complianceLessonsLearned: existing, compliancePostImplementationReview: options.compliancePostImplementationReview, complianceProgramHealth: options.complianceProgramHealth }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-lessons-learned', status: complianceLessonsLearned.lessonsLearnedStatus }), complianceLessonsLearned, automaticPolicyUpdate: false, automaticTrainingAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-lessons-learned', ...options })
}

export const handler = createComplianceLessonsLearnedHandler()
