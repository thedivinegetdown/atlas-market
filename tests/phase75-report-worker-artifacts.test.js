import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createPaperReportDelivery } from '../lib/reports/paperReportDeliveryEngine.js'
import { queuePaperReportJob } from '../lib/reports/paperReportJobEngine.js'
import { createPaperReportArtifact, createPaperReportArtifactRepository, downloadPaperReportArtifact, expirePaperReportArtifact, synchronizeDeliveryWithArtifact } from '../lib/reports/paperReportArtifactEngine.js'
import { claimPaperReportWorkerJobs, createPaperReportWorkerRunRepository, PAPER_REPORT_WORKER_EVENTS, runPaperReportWorkerBatch } from '../lib/reports/paperReportWorkerEngine.js'
import { createPaperReportWorkerHandler } from '../netlify/functions/paper-report-worker.js'
import { createPaperReportArtifactsHandler } from '../netlify/functions/paper-report-artifacts.js'
import { createPaperReportArtifactDownloadHandler } from '../netlify/functions/paper-report-artifact-download.js'
import { createPaperReportArtifactExpirationHandler } from '../netlify/functions/paper-report-artifact-expiration.js'

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
      'x-request-id': 'req-phase75',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', artifactId: body.artifactId ?? 'artifact-1', limit: '25' },
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

function job(jobType = 'export-generation', idempotencyKey = jobType) {
  return queuePaperReportJob({ ...fixture(), jobType, idempotencyKey, reportType: 'operations-summary', format: 'csv' }, { emitEvent: false, timestamp: '2026-07-16T10:00:00.000Z' }).paperReportJob
}

describe('Phase 75A worker-backed paper report execution', () => {
  it('adds idempotent worker and artifact persistence with parameterized queries', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_report_worker_runs')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_report_artifacts')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_report_artifact_downloads')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createPaperReportWorkerRunRepository, createPaperReportArtifactRepository]) {
      const query = vi.fn(async () => ({ rows: [] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ id: 'record-1', tenantScope: tenantContext, accountId: 'paper-portfolio', status: 'available', format: 'csv', expiresAt: '2026-07-20T00:00:00.000Z' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('claims ready jobs by tenant, batch size, lease, duplicate suppression, and expired lease recovery', () => {
    const readyJob = job('report-generation', 'ready')
    const duplicate = { ...readyJob }
    const expiredRunning = { ...job('audit-report-generation', 'expired'), status: 'running', lease: { owner: 'old', leaseExpiresAt: '2026-07-16T09:00:00.000Z', timeoutMs: 60000 } }
    const otherTenant = { ...job('export-generation', 'other'), tenantScope: { ...tenantContext, organizationId: 'org-other' } }
    const claimed = claimPaperReportWorkerJobs({
      tenantContext,
      accountId: 'paper-portfolio',
      jobs: [readyJob, duplicate, expiredRunning, otherTenant],
      batchSize: 2,
      leaseOwner: 'worker-a',
    }, { timestamp: '2026-07-16T10:01:00.000Z' })
    expect(claimed.claimedJobs).toHaveLength(2)
    expect(claimed.claimedJobs.every((item) => item.status === 'running' && item.lease.owner === 'worker-a')).toBe(true)
    expect(claimed.deferred.some((item) => item.reason === 'duplicate')).toBe(true)
  })

  it('processes report, export, and audit jobs with bounded batches, deadlines, terminal skipping, and re-entry safety', () => {
    const jobs = [job('report-generation', 'r'), job('export-generation', 'e'), job('audit-report-generation', 'a'), { ...job('report-generation', 'c'), status: 'cancelled' }]
    const delivery = createPaperReportDelivery({ ...fixture(), filename: 'report.csv' }, { emitEvent: false }).paperReportDelivery
    const batch = runPaperReportWorkerBatch({
      ...fixture(),
      jobs,
      batchSize: 3,
      concurrency: 2,
      deadlineMs: 5000,
      paperReportDelivery: delivery,
    }, { emitEvent: false, timestamp: '2026-07-16T10:02:00.000Z', now: () => new Date('2026-07-16T10:02:01.000Z').getTime() })
    const reentry = runPaperReportWorkerBatch({ ...fixture(), jobs: batch.paperReportWorkerRun.processed.map((item) => ({ ...job('report-generation', item.jobId), id: item.jobId, status: 'completed' })) }, { emitEvent: false })
    expect(batch.eventType).toBe(PAPER_REPORT_WORKER_EVENTS.batchCompleted)
    expect(batch.paperReportWorkerRun.processedCount).toBe(2)
    expect(batch.paperReportWorkerRun.deferredCount).toBeGreaterThan(0)
    expect(batch.paperReportWorkerRun.processed.some((item) => item.artifact)).toBe(true)
    expect(reentry.paperReportWorkerRun.processedCount).toBe(0)
  })
})

describe('Phase 75B persisted downloadable export artifacts', () => {
  it('creates artifacts with size limits, safe filename, checksum metadata, delivery sync, and expiration', () => {
    const available = createPaperReportArtifact({ ...fixture(), content: 'id,label\n1,Report', filename: '../unsafe.csv', format: 'csv', exportId: 'export-1' }, { emitEvent: false, timestamp: '2026-07-16T10:00:00.000Z' })
    const failed = createPaperReportArtifact({ ...fixture(), content: 'too-large', maxArtifactBytes: 2, format: 'json' }, { emitEvent: false })
    const delivery = createPaperReportDelivery({ ...fixture(), filename: 'report.csv' }, { emitEvent: false }).paperReportDelivery
    const synced = synchronizeDeliveryWithArtifact({ paperReportDelivery: delivery, artifactRecord: available.artifactRecord }, { emitEvent: false })
    const expired = expirePaperReportArtifact({ ...available.artifactRecord, expiresAt: '2026-07-16T10:01:00.000Z' }, { emitEvent: false, timestamp: '2026-07-16T10:02:00.000Z' })
    expect(available.artifactStatus).toBe('available')
    expect(available.paperReportArtifact.filename).toBe('..-unsafe.csv')
    expect(available.paperReportArtifact.checksum).toMatch(/^fnv1a-/)
    expect(available.paperReportArtifact.content).toBeUndefined()
    expect(failed.artifactStatus).toBe('failed')
    expect(synced.synchronized).toBe(true)
    expect(expired.artifactStatus).toBe('expired')
  })

  it('downloads only available CSV/JSON artifacts and blocks pending, expired, failed, deleted, and corrupted records', () => {
    const artifact = createPaperReportArtifact({ ...fixture(), content: '{"ok":true}', filename: 'report.json', format: 'json' }, { emitEvent: false }).artifactRecord
    const downloaded = downloadPaperReportArtifact(artifact, { emitEvent: false, timestamp: '2026-07-16T10:03:00.000Z' })
    const pending = downloadPaperReportArtifact({ ...artifact, status: 'pending' }, { emitEvent: false })
    const expired = downloadPaperReportArtifact({ ...artifact, expiresAt: '2026-07-16T10:01:00.000Z' }, { emitEvent: false, timestamp: '2026-07-16T10:02:00.000Z' })
    const failed = downloadPaperReportArtifact({ ...artifact, status: 'failed' }, { emitEvent: false })
    const deleted = downloadPaperReportArtifact({ ...artifact, status: 'deleted' }, { emitEvent: false })
    const corrupt = downloadPaperReportArtifact({ ...artifact, content: 'tampered' }, { emitEvent: false })
    expect(downloaded.downloadStatus).toBe('downloaded')
    expect(downloaded.headers['content-disposition']).toContain('report.json')
    expect([pending.downloadStatus, expired.downloadStatus, failed.downloadStatus, deleted.downloadStatus, corrupt.downloadStatus]).toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'blocked'])
  })

  it('serves protected worker and artifact APIs with viewer download, worker trigger denial, pagination-ready lists, and cross-tenant denial', async () => {
    const artifact = createPaperReportArtifact({ ...fixture(), id: 'artifact-1', content: 'id,label\n1,Report', filename: 'report.csv' }, { emitEvent: false }).artifactRecord
    const artifactRepository = {
      list: vi.fn(async () => [{ ...artifact, content: undefined }]),
      get: vi.fn(async ({ tenantContext: requestedTenant }) => requestedTenant.organizationId === 'org-atlas-local' ? artifact : null),
      update: vi.fn(async () => ({ ok: true })),
      create: vi.fn(async () => ({ ok: true })),
    }
    const options = { ...fixture(), database: { connected: false }, organizationMembershipRepository: membershipRepository('viewer'), paperReportArtifactRepository: artifactRepository }
    const viewerWorkerDenied = parseResponse(await createPaperReportWorkerHandler(options)(authEvent('POST', { jobs: [job()] }, 'viewer')))
    const viewerList = parseResponse(await createPaperReportArtifactsHandler(options)(authEvent('GET', {}, 'viewer')))
    const viewerDownload = parseResponse(await createPaperReportArtifactDownloadHandler(options)(authEvent('GET', { artifactId: 'artifact-1' }, 'viewer')))
    const analystWorker = parseResponse(await createPaperReportWorkerHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { jobs: [job('export-generation', 'api-job')], batchSize: 1 }, 'analyst')))
    const analystExpiration = parseResponse(await createPaperReportArtifactExpirationHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { artifactRecord: { ...artifact, expiresAt: '2026-07-16T10:01:00.000Z' }, timestamp: '2026-07-16T10:02:00.000Z' }, 'analyst')))
    const crossTenant = parseResponse(await createPaperReportArtifactDownloadHandler(options)(authEvent('GET', { artifactId: 'artifact-1' }, 'viewer', 'org-other')))
    expect(viewerWorkerDenied.statusCode).toBe(403)
    expect(viewerList.statusCode).toBe(200)
    expect(viewerList.json.data.paperReportArtifacts[0].content).toBeUndefined()
    expect(viewerDownload.statusCode).toBe(200)
    expect(analystWorker.statusCode).toBe(200)
    expect(analystExpiration.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
