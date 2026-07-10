import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceReviewWorkflowRepository, evaluateComplianceReviewWorkflow } from '../../lib/system/complianceReviewWorkflowEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance review workflow access denied', { statusCode: 403, publicMessage: 'compliance review workflow access denied' })
}

export function createComplianceReviewWorkflowsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceReviewWorkflowRepository ?? createComplianceReviewWorkflowRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.workflow, tenantContext, reviewOwnerUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-workflows', status: response.ok ? 'created' : 'blocked' }), workflow: response.workflow, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, reviewStatus: query.reviewStatus, limit: query.limit }) ?? []
    const complianceReviewWorkflow = evaluateComplianceReviewWorkflow({ tenantContext, complianceReviewWorkflows: existing, complianceEvidencePackage: options.complianceEvidencePackage, complianceReadinessCommandCenter: options.complianceReadinessCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-workflows', status: complianceReviewWorkflow.workflowStatus }), complianceReviewWorkflow, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-review-workflows', ...options })
}

export const handler = createComplianceReviewWorkflowsHandler()
