import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceGovernanceReadoutRepository, prepareComplianceGovernanceReadout } from '../../lib/system/complianceGovernanceReadoutEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance governance readout access denied', { statusCode: 403, publicMessage: 'compliance governance readout access denied' })
}

export function createComplianceGovernanceReadoutsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceGovernanceReadoutRepository ?? createComplianceGovernanceReadoutRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.readout, tenantContext, preparedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-governance-readouts', status: response.ok ? 'prepared' : 'blocked' }), readout: response.readout, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, readoutStatus: query.readoutStatus, limit: query.limit }) ?? []
    const complianceGovernanceReadout = prepareComplianceGovernanceReadout({ tenantContext, complianceGovernanceReadouts: existing, complianceRiskCommandCenter: options.complianceRiskCommandCenter, complianceReviewCalendar: options.complianceReviewCalendar, complianceAttestationRenewalPlanning: options.complianceAttestationRenewalPlanning, complianceEscalationPlanning: options.complianceEscalationPlanning }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-governance-readouts', status: complianceGovernanceReadout.readoutStatus }), complianceGovernanceReadout, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-governance-readouts', ...options })
}

export const handler = createComplianceGovernanceReadoutsHandler()
