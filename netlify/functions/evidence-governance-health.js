import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateEvidenceGovernance } from '../../lib/system/evidenceGovernanceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'evidence governance health access denied', { statusCode: 403, publicMessage: 'evidence governance health access denied' })
}

export function createEvidenceGovernanceHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const governance = evaluateEvidenceGovernance({ tenantContext, administrativeEvidence: options.administrativeEvidence, administrativeCases: options.administrativeCases }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'evidence-governance-health', status: governance.governanceStatus }), governanceSummary: governance.governanceSummary, governanceStatus: governance.governanceStatus, safeSummariesOnly: true, sensitiveMaterialExcluded: true, automaticDeletion: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'evidence-governance-health', ...options })
}

export const handler = createEvidenceGovernanceHealthHandler()
