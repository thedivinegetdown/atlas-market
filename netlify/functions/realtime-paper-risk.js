import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createRealtimePaperRiskRepository, monitorRealtimePaperRisk } from '../../lib/trading/realTimePaperRiskMonitorEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertRiskAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time paper risk access denied', { statusCode: 403, publicMessage: 'real-time paper risk access denied' })
}

export function createRealtimePaperRiskHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertRiskAccess(membership, event.httpMethod)
    const repository = options.realtimePaperRiskRepository ?? createRealtimePaperRiskRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const risk = monitorRealtimePaperRisk({ ...options, ...body, tenantContext }, { emitEvent: false })
      const saved = await repository.create(risk.realtimePaperRiskSnapshot)
      return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-risk', status: risk.riskStatus }), realtimePaperRisk: { ...risk, persisted: saved.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, riskStatus: query.riskStatus, limit: query.limit }) ?? []
    const realtimePaperRisk = existing[0]
      ? { eventType: 'paperRisk.realtime.monitored', realtimePaperRiskSnapshot: existing[0], riskStatus: existing[0].riskStatus, paperTrading: true, liveOrders: false, brokerExecution: false }
      : monitorRealtimePaperRisk({ ...options, tenantContext, accountId: query.accountId ?? options.accountId }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-risk', status: realtimePaperRisk.riskStatus }), realtimePaperRisk, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-paper-risk', ...options })
}

export const handler = createRealtimePaperRiskHandler()
