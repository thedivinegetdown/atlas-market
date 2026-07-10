import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateComplianceOperationsCommandCenter } from '../../lib/system/complianceOperationsCommandCenterEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance operations health access denied', { statusCode: 403, publicMessage: 'compliance operations health access denied' })
}

export function createComplianceOperationsHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership }) => {
    assertOwnerAdmin(membership)
    const commandCenter = evaluateComplianceOperationsCommandCenter({ complianceEvidencePackage: options.complianceEvidencePackage, complianceReviewWorkflow: options.complianceReviewWorkflow, complianceReadinessCommandCenter: options.complianceReadinessCommandCenter, policyControlAssuranceCommandCenter: options.policyControlAssuranceCommandCenter, administrativeGovernanceCommandCenter: options.administrativeGovernanceCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-operations-health', status: commandCenter.commandCenterStatus }), commandCenter, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-operations-health', ...options })
}

export const handler = createComplianceOperationsHealthHandler()
