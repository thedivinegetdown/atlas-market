import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createEvidenceGovernanceRepository, evaluateEvidenceGovernance } from '../../lib/system/evidenceGovernanceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'evidence governance access denied', { statusCode: 403, publicMessage: 'evidence governance access denied' })
}

export function createEvidenceGovernanceReviewHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.evidenceGovernanceRepository ?? createEvidenceGovernanceRepository(options)
    const existing = await repository.list?.({ tenantContext, governanceStatus: query.governanceStatus, limit: query.limit }) ?? []
    const governance = evaluateEvidenceGovernance({ tenantContext, administrativeEvidence: options.administrativeEvidence, administrativeCases: options.administrativeCases, evidence: existing }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'evidence-governance-review', status: governance.governanceStatus }), governance, safeSummariesOnly: true, sensitiveMaterialExcluded: true, automaticDeletion: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'evidence-governance-review', ...options })
}

export const handler = createEvidenceGovernanceReviewHandler()
