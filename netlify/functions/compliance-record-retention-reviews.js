import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceRecordRetentionReviewRepository, reviewComplianceRecordRetention } from '../../lib/system/complianceRecordRetentionReviewEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance record retention access denied', { statusCode: 403, publicMessage: 'compliance record retention access denied' })
}

export function createComplianceRecordRetentionReviewsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceRecordRetentionReviewRepository ?? createComplianceRecordRetentionReviewRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.review, tenantContext, reviewedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-record-retention-reviews', status: response.ok ? 'reviewed' : 'blocked' }), review: response.review, noDeletion: true, noMutation: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, reviewStatus: query.reviewStatus, retentionDomain: query.retentionDomain, limit: query.limit }) ?? []
    const complianceRecordRetentionReview = reviewComplianceRecordRetention({ tenantContext, complianceRecordRetentionReviews: existing, evidenceGovernance: options.evidenceGovernance, complianceAuditReadinessPackage: options.complianceAuditReadinessPackage, complianceExternalReviewPlanning: options.complianceExternalReviewPlanning, complianceGovernanceDecisionLog: options.complianceGovernanceDecisionLog }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-record-retention-reviews', status: complianceRecordRetentionReview.retentionReviewStatus }), complianceRecordRetentionReview, noDeletion: true, noMutation: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-record-retention-reviews', ...options })
}

export const handler = createComplianceRecordRetentionReviewsHandler()
