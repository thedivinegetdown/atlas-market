import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperOperationsAlertRepository, evaluatePaperOperationsAlerts } from '../../lib/trading/paperOperationsAlertingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper operations alert access denied', { statusCode: 403, publicMessage: 'paper operations alert access denied' })
}

export function createPaperOperationsAlertsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperOperationsAlertRepository ?? createPaperOperationsAlertRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = evaluatePaperOperationsAlerts({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      for (const alert of result.paperOperationsAlerts) await repository.upsert?.(alert)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-alerts', status: result.alertingStatus }), paperOperationsAlerts: result, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const alerts = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, status: query.status, severity: query.severity, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-alerts', status: 'ok' }), paperOperationsAlerts: alerts, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-operations-alerts', ...options })
}

export const handler = createPaperOperationsAlertsHandler()
