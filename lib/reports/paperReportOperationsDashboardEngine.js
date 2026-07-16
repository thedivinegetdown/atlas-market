import { createPaperReportDelivery, validatePaperReportDownload } from './paperReportDeliveryEngine.js'
import { queuePaperReportJob } from './paperReportJobEngine.js'
import { createPaperReportSchedule, triggerDuePaperReportSchedule } from './paperReportScheduleEngine.js'
import { downloadPaperReportArtifact } from './paperReportArtifactEngine.js'
import { runPaperReportWorkerBatch } from './paperReportWorkerEngine.js'

export function preparePaperReportOperations(input = {}, options = {}) {
  const tenantContext = input.tenantContext ?? {}
  const accountId = input.accountId ?? 'paper-portfolio'
  const paperReport = input.paperTradingReport?.paperReport ?? input.paperReport
  const paperReportExport = input.paperReportExport?.paperReportExport ?? input.paperReportExport
  const queued = queuePaperReportJob({
    tenantContext,
    accountId,
    jobType: 'export-generation',
    reportType: paperReport?.reportType ?? 'operations-summary',
    format: paperReportExport?.format ?? 'csv',
    idempotencyKey: 'dashboard-operations-summary-csv-2026-07-13',
  }, { ...options, emitEvent: false, timestamp: '2026-07-13T10:41:00.000Z' })
  const schedule = createPaperReportSchedule({
    tenantContext,
    accountId,
    reportType: paperReport?.reportType ?? 'operations-summary',
    format: 'csv',
    frequency: 'daily',
    timezone: 'America/New_York',
    startAt: '2026-07-12T10:43:00.000Z',
  }, { ...options, emitEvent: false, timestamp: '2026-07-13T10:43:00.000Z' })
  const paperReportSchedule = triggerDuePaperReportSchedule(schedule.paperReportSchedule, { ...options, emitEvent: false, timestamp: '2026-07-13T10:44:00.000Z' })
  const delivery = createPaperReportDelivery({
    tenantContext,
    accountId,
    paperReportExport,
    expiresAt: '2026-07-20T10:45:00.000Z',
  }, { ...options, emitEvent: false, timestamp: '2026-07-13T10:45:00.000Z' })
  const paperReportWorker = runPaperReportWorkerBatch({
    ...input,
    tenantContext,
    accountId,
    jobs: [queued.paperReportJob],
    batchSize: 1,
    concurrency: 1,
    paperReportDelivery: delivery.paperReportDelivery,
  }, { ...options, emitEvent: false, timestamp: '2026-07-13T10:42:00.000Z', now: () => new Date('2026-07-13T10:42:01.000Z').getTime() })
  const artifactRecord = paperReportWorker.paperReportWorkerRun.processed[0]?.artifactRecord
  const paperReportArtifactDownload = artifactRecord
    ? downloadPaperReportArtifact(artifactRecord, { ...options, emitEvent: false, timestamp: '2026-07-13T10:47:00.000Z' })
    : null
  return {
    paperReportJob: {
      eventType: paperReportWorker.paperReportWorkerRun.processed[0]?.status === 'completed' ? 'paperReportJob.completed' : queued.eventType,
      paperReportJob: paperReportWorker.paperReportWorkerRun.processed[0] ? { ...queued.paperReportJob, status: paperReportWorker.paperReportWorkerRun.processed[0].status } : queued.paperReportJob,
    },
    paperReportSchedule,
    paperReportDelivery: {
      ...delivery,
      downloadValidation: validatePaperReportDownload(delivery.paperReportDelivery, { timestamp: '2026-07-13T10:46:00.000Z' }),
    },
    paperReportWorker,
    paperReportArtifact: artifactRecord ? { eventType: 'paperReportArtifact.available', paperReportArtifact: paperReportWorker.paperReportWorkerRun.processed[0].artifact } : null,
    paperReportArtifactDownload,
  }
}
