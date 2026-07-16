import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  cancelPaperReportJob,
  completePaperReportJob,
  createPaperReportJobRepository,
  executePaperReportJob,
  failPaperReportJob,
  PAPER_REPORT_JOB_EVENTS,
  queuePaperReportJob,
  recoverExpiredLease,
  startPaperReportJob,
} from '../lib/reports/paperReportJobEngine.js'
import {
  calculateNextReportRun,
  createPaperReportSchedule,
  createPaperReportScheduleRepository,
  PAPER_REPORT_SCHEDULE_EVENTS,
  triggerDuePaperReportSchedule,
  updatePaperReportSchedule,
} from '../lib/reports/paperReportScheduleEngine.js'
import {
  createPaperReportDelivery,
  createPaperReportDeliveryRepository,
  PAPER_REPORT_DELIVERY_EVENTS,
  updatePaperReportDelivery,
  validatePaperReportDownload,
} from '../lib/reports/paperReportDeliveryEngine.js'
import { createPaperReportJobsHandler } from '../netlify/functions/paper-report-jobs.js'
import { createPaperReportJobActionHandler } from '../netlify/functions/paper-report-job-action.js'
import { createPaperReportSchedulesHandler } from '../netlify/functions/paper-report-schedules.js'
import { createPaperReportScheduleActionHandler } from '../netlify/functions/paper-report-schedule-action.js'
import { createPaperReportScheduleRunHandler } from '../netlify/functions/paper-report-schedule-run.js'
import { createPaperReportDeliveriesHandler } from '../netlify/functions/paper-report-deliveries.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'analyst', organizationId = 'org-atlas-local') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase74',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function membershipRepository(role = 'analyst') {
  return {
    getMembership: vi.fn(async (organizationId) => organizationId === 'org-atlas-local'
      ? { id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' }
      : null),
  }
}

function fixture() {
  return {
    tenantContext,
    accountId: 'paper-portfolio',
    realtimePaperPortfolio: { currentCashSummary: { cash: 100000 }, currentEquitySummary: { equity: 100050 }, openPositionsSummary: { totalOpenPositions: 1 } },
    realtimePaperPerformance: { realtimePaperPerformanceSummary: { totalTrades: 1 } },
    realtimePortfolioReconciliation: { reconciliationStatus: 'reconciled', realtimePortfolioReconciliationSummary: { mismatch: 0 } },
    realtimePaperRisk: { riskStatus: 'healthy' },
    realtimePaperOperations: { operationsStatus: 'healthy' },
  }
}

describe('Phase 74A asynchronous report job engine', () => {
  it('creates idempotent job persistence and suppresses duplicates without storing report payloads in job tables', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_report_jobs')
    expect(sql).toContain('UNIQUE (organization_id, team_workspace_id, account_id, idempotency_key)')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [{ payload: { id: 'existing-job', status: 'queued' } }] }))
    const repository = createPaperReportJobRepository({ database: { connected: true, query } })
    const job = queuePaperReportJob({ ...fixture(), jobType: 'report-generation', idempotencyKey: 'same-job' }, { emitEvent: false })
    await repository.create(job.paperReportJob)
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (organization_id, team_workspace_id, account_id, idempotency_key)')
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    expect(job.paperReportJob.payloadStored).toBe(false)
  })

  it('runs lifecycle, retry, lease recovery, cancellation, and immutable terminal states safely', () => {
    const queued = queuePaperReportJob({ ...fixture(), jobType: 'export-generation', idempotencyKey: 'life-cycle' }, { emitEvent: false, timestamp: '2026-07-16T10:00:00.000Z' })
    const started = startPaperReportJob(queued.paperReportJob, { emitEvent: false, timestamp: '2026-07-16T10:01:00.000Z' })
    const recovered = recoverExpiredLease(started.paperReportJob, { timestamp: '2026-07-16T10:03:00.000Z' })
    const retried = failPaperReportJob({ paperReportJob: started.paperReportJob, error: { code: 'ETIMEDOUT', transient: true } }, { emitEvent: false, timestamp: '2026-07-16T10:02:00.000Z' })
    const cancelled = cancelPaperReportJob(retried.paperReportJob, { emitEvent: false, timestamp: '2026-07-16T10:04:00.000Z' })
    const immutable = completePaperReportJob(cancelled.paperReportJob, { emitEvent: false })
    expect(queued.eventType).toBe(PAPER_REPORT_JOB_EVENTS.queued)
    expect(started.paperReportJob.status).toBe('running')
    expect(recovered.status).toBe('queued')
    expect(retried.paperReportJob.status).toBe('queued')
    expect(retried.paperReportJob.normalizedPublicFailureCode).toBe('transient_failure')
    expect(cancelled.paperReportJob.status).toBe('cancelled')
    expect(immutable.immutableTerminalState).toBe(true)
  })

  it('orchestrates existing report engines only', () => {
    const queued = queuePaperReportJob({ ...fixture(), jobType: 'export-generation', reportType: 'operations-summary', format: 'json' }, { emitEvent: false })
    const completed = executePaperReportJob({ ...fixture(), paperReportJob: queued.paperReportJob }, { emitEvent: false })
    expect(completed.eventType).toBe(PAPER_REPORT_JOB_EVENTS.completed)
    expect(completed.paperReportJob.outputReferences.length).toBe(2)
    expect(completed.paperReportJob.liveOrders).toBe(false)
  })
})

describe('Phase 74B scheduled report engine', () => {
  it('calculates timezone-aware next runs, deduplicates occurrences, and triggers jobs', async () => {
    const next = calculateNextReportRun({ from: '2026-07-16T10:00:00.000Z', frequency: 'weekly', timezone: 'America/New_York' })
    const schedule = createPaperReportSchedule({ ...fixture(), frequency: 'daily', timezone: 'America/New_York', startAt: '2026-07-15T10:00:00.000Z' }, { emitEvent: false, timestamp: '2026-07-16T10:00:00.000Z' })
    const triggered = triggerDuePaperReportSchedule(schedule.paperReportSchedule, { emitEvent: false, timestamp: '2026-07-16T10:01:00.000Z' })
    const duplicate = triggerDuePaperReportSchedule(triggered.paperReportSchedule, { emitEvent: false, timestamp: '2026-07-16T10:02:00.000Z' })
    const disabled = updatePaperReportSchedule({ paperReportSchedule: triggered.paperReportSchedule, updates: { enabled: false } }, { emitEvent: false })
    const query = vi.fn(async () => ({ rows: [] }))
    await createPaperReportScheduleRepository({ database: { connected: true, query } }).create(schedule.paperReportSchedule)
    expect(next.nextRunAt).toBe('2026-07-23T10:00:00.000Z')
    expect(schedule.eventType).toBe(PAPER_REPORT_SCHEDULE_EVENTS.created)
    expect(triggered.eventType).toBe(PAPER_REPORT_SCHEDULE_EVENTS.triggered)
    expect(duplicate.triggered).toBe(false)
    expect(disabled.eventType).toBe(PAPER_REPORT_SCHEDULE_EVENTS.disabled)
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })
})

describe('Phase 74C report delivery and API authorization', () => {
  it('manages delivery lifecycle, expiration, safe filenames, and append-only history', async () => {
    const delivery = createPaperReportDelivery({ ...fixture(), filename: '../unsafe report.csv', byteLength: 200 }, { emitEvent: false, timestamp: '2026-07-16T10:00:00.000Z' })
    const delivered = updatePaperReportDelivery({ paperReportDelivery: delivery.paperReportDelivery, status: 'delivered', tenantContext }, { emitEvent: false, timestamp: '2026-07-16T10:01:00.000Z' })
    const expired = updatePaperReportDelivery({ paperReportDelivery: { ...delivered.paperReportDelivery, expiresAt: '2026-07-16T10:02:00.000Z' }, status: 'available', tenantContext }, { emitEvent: false, timestamp: '2026-07-16T10:03:00.000Z' })
    const validation = validatePaperReportDownload(expired.paperReportDelivery, { timestamp: '2026-07-16T10:04:00.000Z' })
    const query = vi.fn(async () => ({ rows: [] }))
    await createPaperReportDeliveryRepository({ database: { connected: true, query } }).create(delivery.paperReportDelivery)
    expect(delivery.eventType).toBe(PAPER_REPORT_DELIVERY_EVENTS.available)
    expect(delivery.paperReportDelivery.filename).toBe('..-unsafe-report.csv')
    expect(delivered.eventType).toBe(PAPER_REPORT_DELIVERY_EVENTS.delivered)
    expect(expired.eventType).toBe(PAPER_REPORT_DELIVERY_EVENTS.expired)
    expect(expired.paperReportDelivery.history.length).toBe(3)
    expect(validation.valid).toBe(false)
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves tenant-scoped APIs with viewer read-only, analyst operations, owner/admin delete, and cross-tenant denial', async () => {
    const options = { ...fixture(), database: { connected: false }, organizationMembershipRepository: membershipRepository('viewer') }
    const jobsRead = parseResponse(await createPaperReportJobsHandler(options)(authEvent('GET', {}, 'viewer')))
    const schedulesRead = parseResponse(await createPaperReportSchedulesHandler(options)(authEvent('GET', {}, 'viewer')))
    const deliveriesRead = parseResponse(await createPaperReportDeliveriesHandler(options)(authEvent('GET', {}, 'viewer')))
    const viewerDenied = parseResponse(await createPaperReportJobsHandler(options)(authEvent('POST', { jobType: 'report-generation' }, 'viewer')))
    const analystJob = parseResponse(await createPaperReportJobActionHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { ...queuePaperReportJob(fixture(), { emitEvent: false }).paperReportJob, action: 'run' }, 'analyst')))
    const analystSchedule = parseResponse(await createPaperReportScheduleRunHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', createPaperReportSchedule({ ...fixture(), startAt: '2026-07-15T10:00:00.000Z' }, { emitEvent: false }).paperReportSchedule, 'analyst')))
    const ownerDelete = parseResponse(await createPaperReportScheduleActionHandler({ ...options, organizationMembershipRepository: membershipRepository('owner') })(authEvent('POST', { ...createPaperReportSchedule(fixture(), { emitEvent: false }).paperReportSchedule, action: 'delete' }, 'owner')))
    const analystDelivery = parseResponse(await createPaperReportDeliveriesHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { filename: 'report.csv', status: 'available' }, 'analyst')))
    const crossTenant = parseResponse(await createPaperReportDeliveriesHandler(options)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect([jobsRead.statusCode, schedulesRead.statusCode, deliveriesRead.statusCode]).toEqual([200, 200, 200])
    expect(viewerDenied.statusCode).toBe(403)
    expect(analystJob.statusCode).toBe(200)
    expect(analystSchedule.statusCode).toBe(200)
    expect(ownerDelete.statusCode).toBe(200)
    expect(analystDelivery.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
