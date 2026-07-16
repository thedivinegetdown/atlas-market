import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportJobRepository, queuePaperReportJob } from '../../lib/reports/paperReportJobEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report job access denied', { statusCode: 403, publicMessage: 'paper report job access denied' })
}

export function createPaperReportJobsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperReportJobRepository ?? createPaperReportJobRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const queued = queuePaperReportJob({ ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(queued.paperReportJob)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-jobs', status: queued.jobStatus }), paperReportJob: { ...queued, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const jobs = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, status: query.status, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-jobs', status: 'ok' }), paperReportJobs: jobs, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-jobs', ...options })
}

export const handler = createPaperReportJobsHandler()
