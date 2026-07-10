import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateInvestigationRemediationCommandCenter } from '../../lib/system/investigationRemediationCommandCenterEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'investigation remediation health access denied', { statusCode: 403, publicMessage: 'investigation remediation health access denied' })
}

export function createInvestigationRemediationHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership }) => {
    assertOwnerAdmin(membership)
    const commandCenter = evaluateInvestigationRemediationCommandCenter({
      administrativeCases: options.administrativeCases,
      administrativeEvidence: options.administrativeEvidence,
      remediationPlanning: options.remediationPlanning,
      tenantAdministrationOperations: options.tenantAdministrationOperations,
      operatorAttention: options.operatorAttention,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'investigation-remediation-health', status: commandCenter.commandCenterStatus }), commandCenter, safeSummariesOnly: true, sensitiveMaterialExcluded: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'investigation-remediation-health', ...options })
}

export const handler = createInvestigationRemediationHealthHandler()
