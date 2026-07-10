import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceAttestationRenewalRepository, planComplianceAttestationRenewals } from '../../lib/system/complianceAttestationRenewalPlannerEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance attestation renewal access denied', { statusCode: 403, publicMessage: 'compliance attestation renewal access denied' })
}

export function createComplianceAttestationRenewalsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceAttestationRenewalRepository ?? createComplianceAttestationRenewalRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.renewal, tenantContext })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-attestation-renewals', status: response.ok ? 'planned' : 'blocked' }), renewal: response.renewal, automaticRenewal: false, automaticAttestation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, renewalStatus: query.renewalStatus, limit: query.limit }) ?? []
    const complianceAttestationRenewalPlanning = planComplianceAttestationRenewals({ tenantContext, complianceAttestationRenewals: existing, policyAttestation: options.policyAttestation, complianceObligationMapping: options.complianceObligationMapping, complianceReviewCalendar: options.complianceReviewCalendar }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-attestation-renewals', status: complianceAttestationRenewalPlanning.renewalStatus }), complianceAttestationRenewalPlanning, automaticRenewal: false, automaticAttestation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-attestation-renewals', ...options })
}

export const handler = createComplianceAttestationRenewalsHandler()
