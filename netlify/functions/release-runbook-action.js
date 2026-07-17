import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseRunbookRepository, updateReleaseRunbookItem } from '../../lib/system/releaseRunbookRecoveryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release runbook action denied', { statusCode: 403, publicMessage: 'release runbook action denied' })
}

export function createReleaseRunbookActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, user }) => {
    assertAccess(membership)
    const repository = options.releaseRunbookRepository ?? createReleaseRunbookRepository(options)
    const result = updateReleaseRunbookItem({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId, actor: { id: user.id, role: membership.role } }, { emitEvent: false })
    const saved = await repository.createItem?.(result.runbookItem)
    await repository.appendActivity?.(result.runbookActivity)
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-runbook-action', status: result.runbookItem.status }), releaseRunbookAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-runbook-action', ...options })
}

export const handler = createReleaseRunbookActionHandler()
