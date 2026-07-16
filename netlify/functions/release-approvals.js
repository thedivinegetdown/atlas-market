import { createReleaseApprovalRepository } from '../../lib/system/releaseApprovalWorkflowEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createReleaseApprovalsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, tenantContext }) => {
    const repository = options.releaseApprovalRepository ?? createReleaseApprovalRepository(options)
    const approvals = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, approvalState: query.approvalState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-approvals', status: 'ok' }), releaseApprovals: approvals, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-approvals', ...options })
}

export const handler = createReleaseApprovalsHandler()
