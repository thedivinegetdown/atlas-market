import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceAdoptionReadinessRepository, evaluateComplianceAdoptionReadiness } from '../../lib/system/complianceAdoptionReadinessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance adoption readiness access denied', { statusCode: 403, publicMessage: 'compliance adoption readiness access denied' })
}

export function createComplianceAdoptionReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceAdoptionReadinessRepository ?? createComplianceAdoptionReadinessRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.readiness, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-adoption-readiness', status: response.ok ? 'evaluated' : 'blocked' }), readiness: response.readiness, automaticAdoption: false, automaticRemediation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, adoptionStatus: query.adoptionStatus, limit: query.limit }) ?? []
    const complianceAdoptionReadiness = evaluateComplianceAdoptionReadiness({ tenantContext, complianceAdoptionReadiness: existing, complianceImprovementOpportunity: options.complianceImprovementOpportunity, complianceResourcePlanning: options.complianceResourcePlanning, complianceTrainingReadiness: options.complianceTrainingReadiness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-adoption-readiness', status: complianceAdoptionReadiness.adoptionReadinessStatus }), complianceAdoptionReadiness, automaticAdoption: false, automaticRemediation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-adoption-readiness', ...options })
}

export const handler = createComplianceAdoptionReadinessHandler()
