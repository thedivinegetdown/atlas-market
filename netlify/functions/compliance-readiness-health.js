import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateComplianceReadinessCommandCenter } from '../../lib/system/complianceReadinessCommandCenterEngine.js'
import { evaluateControlTesting } from '../../lib/system/controlTestingEngine.js'
import { evaluatePolicyAttestations } from '../../lib/system/policyAttestationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance readiness access denied', { statusCode: 403, publicMessage: 'compliance readiness access denied' })
}

export function createComplianceReadinessHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const policyAttestation = options.policyAttestation ?? evaluatePolicyAttestations({ tenantContext, policyGovernance: options.policyGovernance, controlAssurance: options.controlAssurance }, { emitEvent: false })
    const controlTesting = options.controlTesting ?? evaluateControlTesting({ tenantContext, policyGovernance: options.policyGovernance, controlAssurance: options.controlAssurance }, { emitEvent: false })
    const commandCenter = evaluateComplianceReadinessCommandCenter({ policyAttestation, controlTesting, policyControlAssuranceCommandCenter: options.policyControlAssuranceCommandCenter, administrativeGovernanceCommandCenter: options.administrativeGovernanceCommandCenter, enterpriseReleaseControl: options.enterpriseReleaseControl }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-readiness-health', status: commandCenter.commandCenterStatus }), commandCenter, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-readiness-health', ...options })
}

export const handler = createComplianceReadinessHealthHandler()
