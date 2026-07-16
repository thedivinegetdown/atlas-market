import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseApprovalRepository, transitionReleaseApproval } from '../../lib/system/releaseApprovalWorkflowEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release approval action denied', { statusCode: 403, publicMessage: 'release approval action denied' })
}

export function createReleaseApprovalActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, user }) => {
    assertAccess(membership)
    const repository = options.releaseApprovalRepository ?? createReleaseApprovalRepository(options)
    const result = transitionReleaseApproval({
      ...body,
      tenantContext,
      accountId: body.accountId ?? query.accountId ?? options.accountId,
      actor: { id: user.id, role: membership.role },
      decision: body.action ?? body.decision ?? 'approved',
    }, { emitEvent: false })
    const saved = await repository.create?.(result.releaseApproval)
    await repository.appendActivity?.(result.approvalActivity)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-approval-action', status: result.approvalState }), releaseApprovalAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-approval-action', ...options })
}

export const handler = createReleaseApprovalActionHandler()
