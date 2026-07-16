import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportJobRepository } from '../../lib/reports/paperReportJobEngine.js'
import { createPaperReportScheduleRepository, triggerDuePaperReportSchedule } from '../../lib/reports/paperReportScheduleEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report schedule run denied', { statusCode: 403, publicMessage: 'paper report schedule run denied' })
}

export function createPaperReportScheduleRunHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertAccess(membership)
    const scheduleRepository = options.paperReportScheduleRepository ?? createPaperReportScheduleRepository(options)
    const jobRepository = options.paperReportJobRepository ?? createPaperReportJobRepository(options)
    const schedule = { ...(body.paperReportSchedule ?? body), tenantScope: tenantContext, accountId: body.accountId ?? body.paperReportSchedule?.accountId ?? options.accountId ?? 'paper-portfolio' }
    const triggered = triggerDuePaperReportSchedule(schedule, { emitEvent: false, timestamp: body.timestamp })
    const savedSchedule = await scheduleRepository.update?.(triggered.paperReportSchedule)
    const savedJob = triggered.paperReportJob ? await jobRepository.create?.(triggered.paperReportJob) : null
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-schedule-run', status: triggered.triggered ? 'triggered' : 'skipped' }), paperReportScheduleRun: { ...triggered, persisted: savedSchedule?.ok, jobPersisted: savedJob?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-schedule-run', ...options })
}

export const handler = createPaperReportScheduleRunHandler()
