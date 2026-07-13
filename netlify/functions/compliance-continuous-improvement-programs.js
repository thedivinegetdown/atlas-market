import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceContinuousImprovementProgramRepository, evaluateComplianceContinuousImprovementProgram } from '../../lib/system/complianceContinuousImprovementProgramEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance continuous improvement access denied', { statusCode: 403, publicMessage: 'compliance continuous improvement access denied' })
}

export function createComplianceContinuousImprovementProgramsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceContinuousImprovementProgramRepository ?? createComplianceContinuousImprovementProgramRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.program, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-continuous-improvement-programs', status: response.ok ? 'evaluated' : 'blocked' }), program: response.program, automaticProgramChange: false, automaticRemediation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, programStatus: query.programStatus, limit: query.limit }) ?? []
    const complianceContinuousImprovementProgram = evaluateComplianceContinuousImprovementProgram({ tenantContext, complianceContinuousImprovementPrograms: existing, complianceBenefitRealization: options.complianceBenefitRealization, complianceImprovementOutcomeReview: options.complianceImprovementOutcomeReview, complianceProgramHealth: options.complianceProgramHealth }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-continuous-improvement-programs', status: complianceContinuousImprovementProgram.continuousImprovementStatus }), complianceContinuousImprovementProgram, automaticProgramChange: false, automaticRemediation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-continuous-improvement-programs', ...options })
}

export const handler = createComplianceContinuousImprovementProgramsHandler()
