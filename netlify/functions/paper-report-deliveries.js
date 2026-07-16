import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportDelivery, createPaperReportDeliveryRepository, updatePaperReportDelivery, validatePaperReportDownload } from '../../lib/reports/paperReportDeliveryEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report delivery access denied', { statusCode: 403, publicMessage: 'paper report delivery access denied' })
}

export function createPaperReportDeliveriesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperReportDeliveryRepository ?? createPaperReportDeliveryRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const current = body.paperReportDelivery
        ? updatePaperReportDelivery({ ...body, paperReportDelivery: { ...body.paperReportDelivery, tenantScope: tenantContext } }, { emitEvent: false })
        : createPaperReportDelivery({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const validation = validatePaperReportDownload(current.paperReportDelivery)
      const saved = await repository.create?.(current.paperReportDelivery)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-deliveries', status: current.deliveryStatus }), paperReportDelivery: { ...current, downloadValidation: validation, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const deliveries = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, status: query.status, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-deliveries', status: 'ok' }), paperReportDeliveries: deliveries, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-deliveries', ...options })
}

export const handler = createPaperReportDeliveriesHandler()
