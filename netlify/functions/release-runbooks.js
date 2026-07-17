import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseRunbookRepository, generateReleaseRunbook } from '../../lib/system/releaseRunbookRecoveryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release runbook access denied', { statusCode: 403, publicMessage: 'release runbook access denied' })
}

export function createReleaseRunbooksHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseRunbookRepository ?? createReleaseRunbookRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const generated = generateReleaseRunbook({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(generated.releaseRunbook)
      for (const item of generated.releaseRunbookItems) await repository.createItem?.(item)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-runbooks', status: generated.releaseRunbook.recoveryReadinessState }), releaseRunbook: { ...generated, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const runbooks = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, recoveryReadinessState: query.recoveryReadinessState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-runbooks', status: 'ok' }), releaseRunbooks: runbooks, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-runbooks', ...options })
}

export const handler = createReleaseRunbooksHandler()
