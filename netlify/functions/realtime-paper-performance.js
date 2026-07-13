import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimePaperPerformanceRepository, streamRealtimePaperPerformance } from '../../lib/trading/realTimePaperPerformanceStreamEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertPerformanceAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time paper performance access denied', { statusCode: 403, publicMessage: 'real-time paper performance access denied' })
}

export function createRealtimePaperPerformanceHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertPerformanceAccess(membership, event.httpMethod)
    const repository = options.realtimePaperPerformanceRepository ?? createRealtimePaperPerformanceRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const performance = streamRealtimePaperPerformance({ ...options, ...body, tenantContext }, { emitEvent: false })
      const saved = await repository.create(performance.realtimePaperPerformanceSnapshot)
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-performance', status: performance.performanceStatus }), realtimePaperPerformance: { ...performance, persisted: saved.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, performanceStatus: query.performanceStatus, limit: query.limit }) ?? []
    const realtimePaperPerformance = existing[0]
      ? { eventType: 'paperPerformance.realtime.updated', realtimePaperPerformanceSnapshot: existing[0], performanceStatus: existing[0].performanceStatus, paperTrading: true, liveOrders: false, brokerExecution: false }
      : streamRealtimePaperPerformance({ ...options, tenantContext, accountId: query.accountId ?? options.accountId }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-performance', status: realtimePaperPerformance.performanceStatus }), realtimePaperPerformance, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-paper-performance', ...options })
}

export const handler = createRealtimePaperPerformanceHandler()
