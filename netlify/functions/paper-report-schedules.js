import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportSchedule, createPaperReportScheduleRepository } from '../../lib/reports/paperReportScheduleEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report schedule access denied', { statusCode: 403, publicMessage: 'paper report schedule access denied' })
}

export function createPaperReportSchedulesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperReportScheduleRepository ?? createPaperReportScheduleRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const schedule = createPaperReportSchedule({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(schedule.paperReportSchedule)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-schedules', status: schedule.scheduleStatus }), paperReportSchedule: { ...schedule, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const schedules = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, status: query.status, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-schedules', status: 'ok' }), paperReportSchedules: schedules, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-schedules', ...options })
}

export const handler = createPaperReportSchedulesHandler()
