import { createPaperReportArtifact, synchronizeDeliveryWithArtifact } from './paperReportArtifactEngine.js'
import { executePaperReportJob, recoverExpiredLease, startPaperReportJob } from './paperReportJobEngine.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_REPORT_WORKER_EVENTS = Object.freeze({
  batchStarted: 'paperReportWorker.batchStarted',
  jobProcessed: 'paperReportWorker.jobProcessed',
  jobDeferred: 'paperReportWorker.jobDeferred',
  batchCompleted: 'paperReportWorker.batchCompleted',
  batchFailed: 'paperReportWorker.batchFailed',
})

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function scope(input = {}) {
  const tenant = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenant.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenant.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenant.userId ?? input.userId ?? null,
    role: tenant.role ?? input.role ?? null,
  }
}

function terminal(status) {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(status)
}

function ready(job = {}, timestamp) {
  if (terminal(job.status)) return false
  if (job.status === 'queued') {
    if (!job.nextRetryAt) return true
    return new Date(job.nextRetryAt).getTime() <= new Date(timestamp).getTime()
  }
  if (job.status === 'running') {
    return new Date(job.lease?.leaseExpiresAt ?? 0).getTime() <= new Date(timestamp).getTime()
  }
  return false
}

function sameScope(job = {}, tenantContext = {}, accountId) {
  return job.tenantScope?.organizationId === tenantContext.organizationId
    && (job.tenantScope?.teamWorkspaceId ?? null) === (tenantContext.teamWorkspaceId ?? null)
    && (!accountId || job.accountId === accountId)
}

export function claimPaperReportWorkerJobs(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const tenantContext = scope(input)
  const batchSize = Math.min(25, Math.max(1, Number(input.batchSize ?? options.batchSize ?? 5)))
  const leaseOwner = String(input.leaseOwner ?? options.leaseOwner ?? `worker-${Date.parse(timestamp) || Date.now()}`).slice(0, 120)
  const claimedIds = new Set()
  const deferred = []
  const claimedJobs = []
  for (const original of input.jobs ?? []) {
    const recovered = recoverExpiredLease(original, { timestamp })
    const job = recovered.leaseRecovered ? recovered : original
    if (claimedIds.has(job.id) || !sameScope(job, tenantContext, input.accountId) || !ready(job, timestamp)) {
      deferred.push({ jobId: job.id, reason: claimedIds.has(job.id) ? 'duplicate' : terminal(job.status) ? 'terminal' : 'not_ready' })
      continue
    }
    claimedIds.add(job.id)
    claimedJobs.push(startPaperReportJob(job, { emitEvent: false, timestamp, leaseOwner }).paperReportJob)
    if (claimedJobs.length >= batchSize) break
  }
  return {
    eventType: PAPER_REPORT_WORKER_EVENTS.batchStarted,
    timestamp,
    leaseOwner,
    batchSize,
    claimedJobs,
    deferred,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function runPaperReportWorkerBatch(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const deadlineMs = Math.min(60_000, Math.max(100, Number(input.deadlineMs ?? options.deadlineMs ?? 5000)))
  const concurrency = Math.min(10, Math.max(1, Number(input.concurrency ?? options.concurrency ?? 2)))
  const startedAt = new Date(timestamp).getTime()
  const batch = claimPaperReportWorkerJobs(input, options)
  const processed = []
  const deferred = [...batch.deferred]
  try {
    for (const job of batch.claimedJobs) {
      if (processed.length >= concurrency || new Date(options.now?.() ?? Date.now()).getTime() - startedAt > deadlineMs) {
        deferred.push({ jobId: job.id, reason: 'deadline_or_concurrency' })
        continue
      }
      const result = executePaperReportJob({ ...input, paperReportJob: job }, { ...options, emitEvent: false, timestamp: nowIso() })
      let artifact = null
      let deliverySync = null
      if (result.paperReportJob.status === 'completed' && result.paperReportJobOutput?.paperReportExport) {
        artifact = createPaperReportArtifact({
          tenantContext: job.tenantScope,
          accountId: job.accountId,
          paperReportExport: result.paperReportJobOutput.paperReportExport,
          jobId: job.id,
          scheduleId: input.scheduleId ?? null,
          deliveryId: input.paperReportDelivery?.id ?? null,
          maxArtifactBytes: input.maxArtifactBytes,
        }, { ...options, emitEvent: false }).artifactRecord
        deliverySync = synchronizeDeliveryWithArtifact({ paperReportDelivery: input.paperReportDelivery, artifactRecord: artifact }, { ...options, emitEvent: false })
      }
      processed.push({
        eventType: PAPER_REPORT_WORKER_EVENTS.jobProcessed,
        jobId: job.id,
        status: result.paperReportJob.status,
        outputReferences: result.paperReportJob.outputReferences ?? [],
        artifact: artifact ? { ...artifact, content: undefined } : null,
        artifactRecord: artifact,
        deliverySynchronized: deliverySync?.synchronized === true,
      })
    }
    const workerRun = {
      id: String(input.id ?? `paper-report-worker-run-${batch.leaseOwner}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
      tenantScope: batch.claimedJobs[0]?.tenantScope ?? scope(input),
      accountId: input.accountId ?? batch.claimedJobs[0]?.accountId ?? 'paper-portfolio',
      status: deferred.length > 0 ? 'partial' : 'completed',
      leaseOwner: batch.leaseOwner,
      batchSize: batch.batchSize,
      concurrency,
      deadlineMs,
      processedCount: processed.length,
      deferredCount: deferred.length,
      startedAt: timestamp,
      completedAt: nowIso(),
      processed,
      deferred,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
    const result = {
      eventType: PAPER_REPORT_WORKER_EVENTS.batchCompleted,
      timestamp: workerRun.completedAt,
      paperReportWorkerRun: workerRun,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
    if (emitEvent) eventBus?.emit?.(PAPER_REPORT_WORKER_EVENTS.batchCompleted, result)
    return result
  } catch {
    const result = {
      eventType: PAPER_REPORT_WORKER_EVENTS.batchFailed,
      timestamp: nowIso(),
      paperReportWorkerRun: {
        status: 'failed',
        normalizedPublicFailureCode: 'paper_report_worker_failed',
        processedCount: processed.length,
        deferredCount: deferred.length,
      },
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
    if (emitEvent) eventBus?.emit?.(PAPER_REPORT_WORKER_EVENTS.batchFailed, result)
    return result
  }
}

export function createPaperReportWorkerRunRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const run = input.paperReportWorkerRun ?? input
      if (!database?.connected) return { ok: true, disabled: true, run }
      const result = await database.query(
        `INSERT INTO atlas_paper_report_worker_runs
          (id, organization_id, team_workspace_id, account_id, status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [run.id, run.tenantScope.organizationId, run.tenantScope.teamWorkspaceId, run.accountId, run.status, run],
      )
      return { ok: true, run: result.rows?.[0]?.payload ?? run }
    },
    async list({ tenantContext = {}, accountId, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_report_worker_runs
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => item.payload)
    },
  }
}
