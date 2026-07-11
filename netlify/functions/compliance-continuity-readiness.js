import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceContinuityReadinessRepository, evaluateComplianceContinuityReadiness } from '../../lib/system/complianceContinuityReadinessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance continuity readiness access denied', { statusCode: 403, publicMessage: 'compliance continuity readiness access denied' })
}

export function createComplianceContinuityReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceContinuityReadinessRepository ?? createComplianceContinuityReadinessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.readiness, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-continuity-readiness', status: response.ok ? 'evaluated' : 'blocked' }), readiness: response.readiness, automaticFailover: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, continuityStatus: query.continuityStatus, limit: query.limit }) ?? []
    const complianceContinuityReadiness = evaluateComplianceContinuityReadiness({ tenantContext, complianceContinuityReadiness: existing, complianceTrainingReadiness: options.complianceTrainingReadiness, complianceThirdPartyOversight: options.complianceThirdPartyOversight, productionOperationsRunbook: options.productionOperationsRunbook }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-continuity-readiness', status: complianceContinuityReadiness.continuityReadinessStatus }), complianceContinuityReadiness, automaticFailover: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-continuity-readiness', ...options })
}

export const handler = createComplianceContinuityReadinessHandler()
