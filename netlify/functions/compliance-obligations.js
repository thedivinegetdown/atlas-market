import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceObligationRepository, evaluateComplianceObligationMapping } from '../../lib/system/complianceObligationMappingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance obligation access denied', { statusCode: 403, publicMessage: 'compliance obligation access denied' })
}

export function createComplianceObligationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceObligationRepository ?? createComplianceObligationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.obligation, tenantContext, mappedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-obligations', status: response.ok ? 'mapped' : 'blocked' }), obligation: response.obligation, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, obligationStatus: query.obligationStatus, obligationDomain: query.obligationDomain, limit: query.limit }) ?? []
    const obligationMapping = evaluateComplianceObligationMapping({ tenantContext, complianceObligations: existing, policyGovernance: options.policyGovernance, controlAssurance: options.controlAssurance, complianceEvidencePackage: options.complianceEvidencePackage, complianceReadinessCommandCenter: options.complianceReadinessCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-obligations', status: obligationMapping.mappingStatus }), obligationMapping, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-obligations', ...options })
}

export const handler = createComplianceObligationsHandler()
