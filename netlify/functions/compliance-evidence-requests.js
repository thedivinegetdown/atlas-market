import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceEvidenceRequestRepository, queueComplianceEvidenceRequests } from '../../lib/system/complianceEvidenceRequestQueueEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance evidence request access denied', { statusCode: 403, publicMessage: 'compliance evidence request access denied' })
}

export function createComplianceEvidenceRequestsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceEvidenceRequestRepository ?? createComplianceEvidenceRequestRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.evidenceRequest, tenantContext, requestedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-evidence-requests', status: response.ok ? 'queued' : 'blocked' }), evidenceRequest: response.request, automaticEvidenceCollection: false, automaticEvidenceExport: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, requestStatus: query.requestStatus, requestPriority: query.requestPriority, limit: query.limit }) ?? []
    const evidenceRequestQueue = queueComplianceEvidenceRequests({ tenantContext, complianceEvidenceRequests: existing, complianceObligationMapping: options.complianceObligationMapping, complianceEvidencePackage: options.complianceEvidencePackage, complianceReviewWorkflow: options.complianceReviewWorkflow }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-evidence-requests', status: evidenceRequestQueue.queueStatus }), evidenceRequestQueue, automaticEvidenceCollection: false, automaticEvidenceExport: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-evidence-requests', ...options })
}

export const handler = createComplianceEvidenceRequestsHandler()
