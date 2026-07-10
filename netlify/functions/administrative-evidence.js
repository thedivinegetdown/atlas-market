import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { collectAdministrativeEvidence, createAdministrativeEvidence, createAdministrativeEvidenceRepository } from '../../lib/system/administrativeEvidenceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative evidence access denied', { statusCode: 403, publicMessage: 'administrative evidence access denied' })
  }
}

export function createAdministrativeEvidenceHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.evidenceRepository ?? createAdministrativeEvidenceRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const created = await createAdministrativeEvidence({ evidence: { ...body.evidence, tenantContext, collectedByUserId: tenantContext.userId } }, { repository, emitEvent: false })
      return { event: apiFoundationEvent({ requestId, endpoint: 'administrative-evidence', status: created.status }), created, sensitiveMaterialExcluded: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existingEvidence = await repository.list?.({ tenantContext, relatedCaseId: query.relatedCaseId, reviewStatus: query.reviewStatus, limit: query.limit }) ?? []
    const evidence = collectAdministrativeEvidence({
      tenantContext,
      administrativeCases: options.administrativeCases,
      operatorAttention: options.operatorAttention,
      userActivityRiskReview: options.userActivityRiskReview,
      administrationWorkflowSla: options.administrationWorkflowSla,
      evidence: existingEvidence,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'administrative-evidence', status: evidence.status }), evidence, pagination: { limit: Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50)), returned: evidence.administrativeEvidence.length }, sensitiveMaterialExcluded: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'administrative-evidence', ...options })
}

export const handler = createAdministrativeEvidenceHandler()
