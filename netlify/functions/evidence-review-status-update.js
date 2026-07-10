import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAdministrativeEvidenceRepository, updateEvidenceReviewStatus } from '../../lib/system/administrativeEvidenceEngine.js'
import { sanitizeId, apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'evidence review update denied', { statusCode: 403, publicMessage: 'evidence review update denied' })
}

export function createEvidenceReviewStatusUpdateHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.evidenceRepository ?? createAdministrativeEvidenceRepository(options)
    const update = await updateEvidenceReviewStatus({ id: sanitizeId(body.id, 'evidence id'), tenantContext, reviewStatus: body.reviewStatus }, { repository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'evidence-review-status-update', status: update.status }), update, humanReviewOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'evidence-review-status-update', ...options })
}

export const handler = createEvidenceReviewStatusUpdateHandler()
