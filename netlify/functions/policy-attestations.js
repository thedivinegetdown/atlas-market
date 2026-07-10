import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPolicyAttestationRepository, evaluatePolicyAttestations } from '../../lib/system/policyAttestationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'policy attestation access denied', { statusCode: 403, publicMessage: 'policy attestation access denied' })
}

export function createPolicyAttestationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.policyAttestationRepository ?? createPolicyAttestationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.attestation, tenantContext, attestedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'policy-attestations', status: response.ok ? 'recorded' : 'blocked' }), attestation: response.attestation, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, attestationStatus: query.attestationStatus, limit: query.limit }) ?? []
    const policyAttestation = evaluatePolicyAttestations({ tenantContext, policyGovernance: options.policyGovernance, controlAssurance: options.controlAssurance, policyAttestations: existing }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'policy-attestations', status: policyAttestation.attestationStatus }), policyAttestation, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'policy-attestations', ...options })
}

export const handler = createPolicyAttestationsHandler()
