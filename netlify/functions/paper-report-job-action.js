import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { cancelPaperReportJob, createPaperReportJobRepository, executePaperReportJob, recoverExpiredLease } from '../../lib/reports/paperReportJobEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report job action denied', { statusCode: 403, publicMessage: 'paper report job action denied' })
}

export function createPaperReportJobActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.paperReportJobRepository ?? createPaperReportJobRepository(options)
    const job = { ...(body.paperReportJob ?? body), tenantScope: tenantContext, accountId: body.accountId ?? body.paperReportJob?.accountId ?? options.accountId ?? 'paper-portfolio' }
    const action = body.action ?? 'run'
    const result = action === 'cancel'
      ? cancelPaperReportJob(job, { emitEvent: false })
      : action === 'recover-lease'
        ? { eventType: 'paperReportJob.leaseRecovered', paperReportJob: recoverExpiredLease(job), paperTrading: true, liveOrders: false, brokerExecution: false }
        : executePaperReportJob({ ...options, ...body, paperReportJob: job }, { emitEvent: false })
    const saved = await repository.update?.(result.paperReportJob)
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-job-action', status: result.paperReportJob?.status ?? 'ok' }), paperReportJobAction: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-job-action', ...options })
}

export const handler = createPaperReportJobActionHandler()
