import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceChangeClosureReadinessRepository, prepareComplianceChangeClosureReadiness } from '../../lib/system/complianceChangeClosureReadinessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance change closure readiness access denied', { statusCode: 403, publicMessage: 'compliance change closure readiness access denied' })
}

export function createComplianceChangeClosureReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceChangeClosureReadinessRepository ?? createComplianceChangeClosureReadinessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.closure, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-change-closure-readiness', status: response.ok ? 'prepared' : 'blocked' }), closure: response.closure, automaticClosure: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, closureStatus: query.closureStatus, limit: query.limit }) ?? []
    const complianceChangeClosureReadiness = prepareComplianceChangeClosureReadiness({ tenantContext, complianceChangeClosureReadiness: existing, complianceChangeVerification: options.complianceChangeVerification, complianceChangeImpactAssessment: options.complianceChangeImpactAssessment }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-change-closure-readiness', status: complianceChangeClosureReadiness.changeClosureReadinessStatus }), complianceChangeClosureReadiness, automaticClosure: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-change-closure-readiness', ...options })
}

export const handler = createComplianceChangeClosureReadinessHandler()
