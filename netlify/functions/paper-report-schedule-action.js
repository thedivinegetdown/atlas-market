import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportScheduleRepository, updatePaperReportSchedule } from '../../lib/reports/paperReportScheduleEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, action) {
  const role = membership?.role
  if (action === 'delete' && ['owner', 'admin'].includes(role)) return
  if (['enable', 'disable', 'update'].includes(action) && ['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report schedule action denied', { statusCode: 403, publicMessage: 'paper report schedule action denied' })
}

export function createPaperReportScheduleActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    const action = body.action ?? 'update'
    assertAccess(membership, action)
    const repository = options.paperReportScheduleRepository ?? createPaperReportScheduleRepository(options)
    const current = { ...(body.paperReportSchedule ?? body), tenantScope: tenantContext, accountId: body.accountId ?? body.paperReportSchedule?.accountId ?? options.accountId ?? 'paper-portfolio' }
    const updates = action === 'disable'
      ? { enabled: false }
      : action === 'enable'
        ? { enabled: true }
        : action === 'delete'
          ? { enabled: false, status: 'deleted' }
          : body.updates ?? body
    const updated = updatePaperReportSchedule({ paperReportSchedule: current, updates }, { emitEvent: false })
    const saved = await repository.update?.(updated.paperReportSchedule)
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-schedule-action', status: updated.scheduleStatus }), paperReportScheduleAction: { ...updated, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-schedule-action', ...options })
}

export const handler = createPaperReportScheduleActionHandler()
