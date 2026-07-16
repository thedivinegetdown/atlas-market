import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportArtifactRepository } from '../../lib/reports/paperReportArtifactEngine.js'
import { createPaperReportJobRepository } from '../../lib/reports/paperReportJobEngine.js'
import { createPaperReportWorkerRunRepository, runPaperReportWorkerBatch } from '../../lib/reports/paperReportWorkerEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertWorkerAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report worker access denied', { statusCode: 403, publicMessage: 'paper report worker access denied' })
}

export function createPaperReportWorkerHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertWorkerAccess(membership)
    const jobRepository = options.paperReportJobRepository ?? createPaperReportJobRepository(options)
    const runRepository = options.paperReportWorkerRunRepository ?? createPaperReportWorkerRunRepository(options)
    const artifactRepository = options.paperReportArtifactRepository ?? createPaperReportArtifactRepository(options)
    const jobs = body.jobs ?? await jobRepository.list?.({ tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId, limit: body.batchSize ?? query.limit ?? 10 }) ?? []
    const worker = runPaperReportWorkerBatch({ ...options, ...body, jobs, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
    await runRepository.create?.(worker.paperReportWorkerRun)
    for (const processed of worker.paperReportWorkerRun.processed ?? []) {
      if (processed.artifactRecord) await artifactRepository.create?.(processed.artifactRecord)
    }
    const publicRun = {
      ...worker.paperReportWorkerRun,
      processed: (worker.paperReportWorkerRun.processed ?? []).map((item) => {
        const publicItem = { ...item }
        delete publicItem.artifactRecord
        return publicItem
      }),
    }
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-worker', status: worker.paperReportWorkerRun.status }), paperReportWorker: { ...worker, paperReportWorkerRun: publicRun }, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-worker', ...options })
}

export const handler = createPaperReportWorkerHandler()
