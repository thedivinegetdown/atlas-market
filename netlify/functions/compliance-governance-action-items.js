import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceGovernanceActionItemRepository, trackComplianceGovernanceActionItems } from '../../lib/system/complianceGovernanceActionItemEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance governance action item access denied', { statusCode: 403, publicMessage: 'compliance governance action item access denied' })
}

export function createComplianceGovernanceActionItemsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceGovernanceActionItemRepository ?? createComplianceGovernanceActionItemRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.actionItem, tenantContext, createdByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-governance-action-items', status: response.ok ? 'tracked' : 'blocked' }), actionItem: response.actionItem, automaticAssignment: false, automaticResolution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, actionStatus: query.actionStatus, actionPriority: query.actionPriority, limit: query.limit }) ?? []
    const complianceGovernanceActionItems = trackComplianceGovernanceActionItems({ tenantContext, complianceGovernanceActionItems: existing, complianceMeetingMinutes: options.complianceMeetingMinutes, complianceRecordRetentionReview: options.complianceRecordRetentionReview, complianceExamReadiness: options.complianceExamReadiness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-governance-action-items', status: complianceGovernanceActionItems.actionItemStatus }), complianceGovernanceActionItems, automaticAssignment: false, automaticResolution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-governance-action-items', ...options })
}

export const handler = createComplianceGovernanceActionItemsHandler()
