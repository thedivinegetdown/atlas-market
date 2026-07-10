import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateAdministrativeGovernanceCommandCenter } from '../../lib/system/administrativeGovernanceCommandCenterEngine.js'
import { evaluateEvidenceGovernance } from '../../lib/system/evidenceGovernanceEngine.js'
import { evaluateRemediationEffectiveness } from '../../lib/system/remediationEffectivenessEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative governance health access denied', { statusCode: 403, publicMessage: 'administrative governance health access denied' })
}

export function createAdministrativeGovernanceHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const evidenceGovernance = options.evidenceGovernance ?? evaluateEvidenceGovernance({ tenantContext, administrativeEvidence: options.administrativeEvidence, administrativeCases: options.administrativeCases }, { emitEvent: false })
    const remediationEffectiveness = options.remediationEffectiveness ?? evaluateRemediationEffectiveness({ tenantContext, remediationPlanning: options.remediationPlanning, administrativeEvidence: options.administrativeEvidence, administrativeCases: options.administrativeCases, operatorAttention: options.operatorAttention, administrationWorkflowSla: options.administrationWorkflowSla }, { emitEvent: false })
    const commandCenter = evaluateAdministrativeGovernanceCommandCenter({ evidenceGovernance, remediationEffectiveness, tenantAdministrationOperations: options.tenantAdministrationOperations, operatorIntelligenceCommandCenter: options.operatorIntelligenceCommandCenter, investigationRemediationCommandCenter: options.investigationRemediationCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'administrative-governance-health', status: commandCenter.commandCenterStatus }), commandCenter, safeSummariesOnly: true, destructiveActionsEnabled: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'administrative-governance-health', ...options })
}

export const handler = createAdministrativeGovernanceHealthHandler()
