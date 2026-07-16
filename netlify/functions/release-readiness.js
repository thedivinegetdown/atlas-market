import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseReadinessDiagnosticsRepository, evaluateReleaseReadinessDiagnostics } from '../../lib/system/releaseReadinessDiagnosticsEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release readiness access denied', { statusCode: 403, publicMessage: 'release readiness access denied' })
}

export function createReleaseReadinessHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseReadinessDiagnosticsRepository ?? createReleaseReadinessDiagnosticsRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const evaluated = evaluateReleaseReadinessDiagnostics({ ...options, ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(evaluated)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-readiness', status: evaluated.releaseReadinessStatus }), releaseReadinessDiagnostics: { ...evaluated, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const snapshots = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, readinessStatus: query.readinessStatus, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-readiness', status: 'ok' }), releaseReadinessDiagnostics: snapshots, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-readiness', ...options })
}

export const handler = createReleaseReadinessHandler()
