import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceTrainingReadinessRepository, evaluateComplianceTrainingReadiness } from '../../lib/system/complianceTrainingReadinessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance training readiness access denied', { statusCode: 403, publicMessage: 'compliance training readiness access denied' })
}

export function createComplianceTrainingReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceTrainingReadinessRepository ?? createComplianceTrainingReadinessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.readiness, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-training-readiness', status: response.ok ? 'evaluated' : 'blocked' }), readiness: response.readiness, automaticAssignment: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, trainingStatus: query.trainingStatus, limit: query.limit }) ?? []
    const complianceTrainingReadiness = evaluateComplianceTrainingReadiness({ tenantContext, complianceTrainingReadiness: existing, complianceResourcePlanning: options.complianceResourcePlanning, complianceProgramHealth: options.complianceProgramHealth }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-training-readiness', status: complianceTrainingReadiness.trainingReadinessStatus }), complianceTrainingReadiness, automaticAssignment: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-training-readiness', ...options })
}

export const handler = createComplianceTrainingReadinessHandler()
