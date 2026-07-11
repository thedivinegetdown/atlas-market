import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceThirdPartyOversightRepository, evaluateComplianceThirdPartyOversight } from '../../lib/system/complianceThirdPartyOversightEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance third-party oversight access denied', { statusCode: 403, publicMessage: 'compliance third-party oversight access denied' })
}

export function createComplianceThirdPartyOversightHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceThirdPartyOversightRepository ?? createComplianceThirdPartyOversightRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.oversight, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-third-party-oversight', status: response.ok ? 'evaluated' : 'blocked' }), oversight: response.oversight, automaticVendorAction: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, oversightStatus: query.oversightStatus, limit: query.limit }) ?? []
    const complianceThirdPartyOversight = evaluateComplianceThirdPartyOversight({ tenantContext, complianceThirdPartyOversight: existing, productionSecurityReadiness: options.productionSecurityReadiness, dataLineage: options.dataLineage }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-third-party-oversight', status: complianceThirdPartyOversight.thirdPartyOversightStatus }), complianceThirdPartyOversight, automaticVendorAction: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-third-party-oversight', ...options })
}

export const handler = createComplianceThirdPartyOversightHandler()
