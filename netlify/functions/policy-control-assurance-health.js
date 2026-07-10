import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateAdministrativePolicyGovernance } from '../../lib/system/administrativePolicyGovernanceEngine.js'
import { evaluateControlAssurance } from '../../lib/system/controlAssuranceEngine.js'
import { evaluatePolicyControlAssuranceCommandCenter } from '../../lib/system/policyControlAssuranceCommandCenterEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'policy control assurance health access denied', { statusCode: 403, publicMessage: 'policy control assurance health access denied' })
}

export function createPolicyControlAssuranceHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const policyGovernance = options.policyGovernance ?? evaluateAdministrativePolicyGovernance({ tenantContext, evidenceGovernance: options.evidenceGovernance, remediationEffectiveness: options.remediationEffectiveness, administrativeGovernanceCommandCenter: options.administrativeGovernanceCommandCenter }, { emitEvent: false })
    const controlAssurance = options.controlAssurance ?? evaluateControlAssurance({ tenantContext, policyGovernance, evidenceGovernance: options.evidenceGovernance, remediationEffectiveness: options.remediationEffectiveness, policyExceptions: options.policyExceptions }, { emitEvent: false })
    const commandCenter = evaluatePolicyControlAssuranceCommandCenter({ policyGovernance, controlAssurance, administrativeGovernanceCommandCenter: options.administrativeGovernanceCommandCenter, tenantAdministrationOperations: options.tenantAdministrationOperations, operatorIntelligenceCommandCenter: options.operatorIntelligenceCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'policy-control-assurance-health', status: commandCenter.commandCenterStatus }), commandCenter, automaticPolicyEnforcement: false, automaticExceptionApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'policy-control-assurance-health', ...options })
}

export const handler = createPolicyControlAssuranceHealthHandler()
