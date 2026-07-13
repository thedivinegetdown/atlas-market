import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperOperationsAlertRepository, normalizePaperOperationsAlert } from '../../lib/trading/paperOperationsAlertingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertWrite(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper operations alert action denied', { statusCode: 403, publicMessage: 'paper operations alert action denied' })
}

export function createPaperOperationsAlertActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertWrite(membership)
    const action = body.action === 'resolve' ? 'resolved' : body.action === 'acknowledge' ? 'acknowledged' : null
    if (!action) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Unsupported alert action', { statusCode: 400, publicMessage: 'unsupported alert action' })
    const repository = options.paperOperationsAlertRepository ?? createPaperOperationsAlertRepository(options)
    const alert = normalizePaperOperationsAlert({
      ...(body.alert ?? {}),
      id: body.alertId ?? body.alert?.id,
      fingerprint: body.fingerprint ?? body.alert?.fingerprint,
      tenantContext,
      accountId: body.accountId ?? options.accountId,
      status: action,
      acknowledgedAt: action === 'acknowledged' ? new Date().toISOString() : body.alert?.acknowledgedAt,
      resolvedAt: action === 'resolved' ? new Date().toISOString() : body.alert?.resolvedAt,
    })
    const saved = await repository.upsert?.(alert)
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-alert-action', status: alert.status }), paperOperationsAlert: saved?.alert ?? alert, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-operations-alert-action', ...options })
}

export const handler = createPaperOperationsAlertActionHandler()
