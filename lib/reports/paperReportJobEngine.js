import { generatePaperAuditReport } from './paperAuditReportingEngine.js'
import { exportPaperReport } from './paperReportExportEngine.js'
import { generatePaperTradingReport } from './paperTradingReportingEngine.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_REPORT_JOB_EVENTS = Object.freeze({
  queued: 'paperReportJob.queued',
  started: 'paperReportJob.started',
  completed: 'paperReportJob.completed',
  failed: 'paperReportJob.failed',
  cancelled: 'paperReportJob.cancelled',
})

export const PAPER_REPORT_JOB_STATES = Object.freeze(['queued', 'running', 'completed', 'failed', 'cancelled', 'expired'])
export const PAPER_REPORT_JOB_TYPES = Object.freeze(['report-generation', 'export-generation', 'audit-report-generation'])

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

function jobId(input = {}, tenantScope = {}) {
  return String(input.id ?? input.jobId ?? `paper-report-job-${tenantScope.organizationId ?? 'tenant'}-${input.accountId ?? 'paper'}-${input.idempotencyKey ?? input.jobType ?? 'job'}`).slice(0, 220)
}

function transientFailure(error) {
  return error?.transient === true || ['ETIMEDOUT', 'ECONNRESET', 'TRANSIENT_FAILURE'].includes(error?.code)
}

function publicFailureCode(error) {
  if (!error) return null
  if (transientFailure(error)) return 'transient_failure'
  if (error?.code === 'cancelled') return 'cancelled'
  return 'report_job_failed'
}

function nextRetryAt(timestamp, attempt, baseDelayMs) {
  return new Date(new Date(timestamp).getTime() + Math.min(60 * 60 * 1000, baseDelayMs * (2 ** Math.max(0, attempt - 1)))).toISOString()
}

function terminal(status) {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(status)
}

export function queuePaperReportJob(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const tenantScope = scope(input)
  const jobType = PAPER_REPORT_JOB_TYPES.includes(input.jobType) ? input.jobType : 'report-generation'
  const accountId = String(input.accountId ?? 'paper-portfolio')
  const idempotencyKey = String(input.idempotencyKey ?? `${jobType}:${accountId}:${input.reportType ?? 'operations-summary'}:${input.format ?? 'csv'}`).slice(0, 220)
  const job = {
    id: jobId({ ...input, jobType, accountId, idempotencyKey }, tenantScope),
    tenantScope,
    accountId,
    jobType,
    status: 'queued',
    idempotencyKey,
    duplicateSuppressionKey: `${tenantScope.organizationId}:${tenantScope.teamWorkspaceId ?? 'none'}:${accountId}:${idempotencyKey}`,
    attempts: 0,
    maxAttempts: Math.min(5, Math.max(1, Number(input.maxAttempts ?? 3))),
    retryPolicy: { baseDelayMs: Math.min(60_000, Math.max(500, Number(input.baseDelayMs ?? 1000))), exponentialBackoff: true, transientOnly: true },
    lease: { owner: null, leasedAt: null, leaseExpiresAt: null, timeoutMs: Math.min(15 * 60_000, Math.max(10_000, Number(input.leaseTimeoutMs ?? 60_000))) },
    normalizedPublicFailureCode: null,
    requestedAt: timestamp,
    updatedAt: timestamp,
    expiresAt: input.expiresAt ?? new Date(new Date(timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    request: {
      reportType: input.reportType ?? 'operations-summary',
      format: input.format ?? 'csv',
      dateRange: input.dateRange ?? {},
      pagination: input.pagination ?? { limit: 25, offset: 0 },
    },
    payloadStored: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  const result = {
    eventType: PAPER_REPORT_JOB_EVENTS.queued,
    timestamp,
    paperReportJob: job,
    jobStatus: tenantScope.organizationId && tenantScope.userId ? 'queued' : 'failed',
    duplicateSuppressed: input.duplicateSuppressed === true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_JOB_EVENTS.queued, result)
  return result
}

export function recoverExpiredLease(job = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const leaseExpiresAt = new Date(job.lease?.leaseExpiresAt ?? 0).getTime()
  if (job.status !== 'running' || leaseExpiresAt > new Date(timestamp).getTime() || terminal(job.status)) return { ...job, leaseRecovered: false }
  return {
    ...job,
    status: 'queued',
    leaseRecovered: true,
    lease: { ...job.lease, owner: null, leasedAt: null, leaseExpiresAt: null },
    updatedAt: timestamp,
  }
}

export function startPaperReportJob(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const job = input.paperReportJob ?? input
  if (terminal(job.status)) return { eventType: PAPER_REPORT_JOB_EVENTS.started, timestamp, paperReportJob: job, immutableTerminalState: true }
  const leaseTimeoutMs = job.lease?.timeoutMs ?? 60_000
  const started = {
    ...job,
    status: 'running',
    attempts: Number(job.attempts ?? 0) + 1,
    lease: {
      owner: String(options.leaseOwner ?? input.leaseOwner ?? 'atlas-report-worker').slice(0, 120),
      leasedAt: timestamp,
      leaseExpiresAt: new Date(new Date(timestamp).getTime() + leaseTimeoutMs).toISOString(),
      timeoutMs: leaseTimeoutMs,
    },
    updatedAt: timestamp,
  }
  const result = { eventType: PAPER_REPORT_JOB_EVENTS.started, timestamp, paperReportJob: started, paperTrading: true, liveOrders: false, brokerExecution: false }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_JOB_EVENTS.started, result)
  return result
}

export function completePaperReportJob(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const job = input.paperReportJob ?? input
  if (terminal(job.status)) return { eventType: PAPER_REPORT_JOB_EVENTS.completed, timestamp, paperReportJob: job, immutableTerminalState: true }
  const completed = {
    ...job,
    status: 'completed',
    completedAt: timestamp,
    updatedAt: timestamp,
    lease: { ...job.lease, owner: null, leasedAt: null, leaseExpiresAt: null },
    outputReferences: (input.outputReferences ?? []).slice(0, 10),
    payloadStored: false,
  }
  const result = { eventType: PAPER_REPORT_JOB_EVENTS.completed, timestamp, paperReportJob: completed, paperTrading: true, liveOrders: false, brokerExecution: false }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_JOB_EVENTS.completed, result)
  return result
}

export function failPaperReportJob(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const job = input.paperReportJob ?? input
  if (terminal(job.status)) return { eventType: PAPER_REPORT_JOB_EVENTS.failed, timestamp, paperReportJob: job, immutableTerminalState: true }
  const error = input.error ?? {}
  const retryable = transientFailure(error) && Number(job.attempts ?? 0) < Number(job.maxAttempts ?? 3)
  const failed = {
    ...job,
    status: retryable ? 'queued' : 'failed',
    retryable,
    nextRetryAt: retryable ? nextRetryAt(timestamp, Number(job.attempts ?? 1), job.retryPolicy?.baseDelayMs ?? 1000) : null,
    normalizedPublicFailureCode: publicFailureCode(error),
    failureSummary: publicFailureCode(error),
    updatedAt: timestamp,
    lease: { ...job.lease, owner: null, leasedAt: null, leaseExpiresAt: null },
  }
  const result = { eventType: PAPER_REPORT_JOB_EVENTS.failed, timestamp, paperReportJob: failed, paperTrading: true, liveOrders: false, brokerExecution: false }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_JOB_EVENTS.failed, result)
  return result
}

export function cancelPaperReportJob(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const job = input.paperReportJob ?? input
  if (terminal(job.status)) return { eventType: PAPER_REPORT_JOB_EVENTS.cancelled, timestamp, paperReportJob: job, immutableTerminalState: true }
  const cancelled = { ...job, status: 'cancelled', cancelledAt: timestamp, updatedAt: timestamp, lease: { ...job.lease, owner: null, leasedAt: null, leaseExpiresAt: null } }
  const result = { eventType: PAPER_REPORT_JOB_EVENTS.cancelled, timestamp, paperReportJob: cancelled, paperTrading: true, liveOrders: false, brokerExecution: false }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_JOB_EVENTS.cancelled, result)
  return result
}

export function executePaperReportJob(input = {}, options = {}) {
  const initialJob = input.paperReportJob ?? input
  const started = initialJob.status === 'running' ? initialJob : startPaperReportJob(input, { ...options, emitEvent: false }).paperReportJob
  try {
    if (started.jobType === 'audit-report-generation') {
      const audit = generatePaperAuditReport({ ...input, tenantContext: started.tenantScope, accountId: started.accountId }, { ...options, emitEvent: false })
      return { ...completePaperReportJob({ paperReportJob: started, outputReferences: [audit.paperAuditReport.id] }, options), paperReportJobOutput: { paperAuditReport: audit.paperAuditReport } }
    }
    const report = generatePaperTradingReport({ ...input, tenantContext: started.tenantScope, accountId: started.accountId, ...started.request }, { ...options, emitEvent: false })
    if (started.jobType === 'export-generation') {
      const exported = exportPaperReport({ ...input, tenantContext: started.tenantScope, paperReport: report.paperReport, format: started.request.format }, { ...options, emitEvent: false })
      return { ...completePaperReportJob({ paperReportJob: started, outputReferences: [report.paperReport.id, exported.paperReportExport.id] }, options), paperReportJobOutput: { paperReport: report.paperReport, paperReportExport: exported.paperReportExport } }
    }
    return { ...completePaperReportJob({ paperReportJob: started, outputReferences: [report.paperReport.id] }, options), paperReportJobOutput: { paperReport: report.paperReport } }
  } catch (error) {
    return failPaperReportJob({ paperReportJob: started, error }, options)
  }
}

export function createPaperReportJobRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const job = input.paperReportJob ?? input
      if (!database?.connected) return { ok: true, disabled: true, job }
      const result = await database.query(
        `INSERT INTO atlas_paper_report_jobs
          (id, organization_id, team_workspace_id, account_id, job_type, status, idempotency_key, lease_owner, lease_expires_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (organization_id, team_workspace_id, account_id, idempotency_key)
         DO UPDATE SET updated_at = atlas_paper_report_jobs.updated_at
         RETURNING payload`,
        [job.id, job.tenantScope.organizationId, job.tenantScope.teamWorkspaceId ?? '', job.accountId, job.jobType, job.status, job.idempotencyKey, job.lease?.owner ?? null, job.lease?.leaseExpiresAt ?? null, job],
      )
      return { ok: true, job: result.rows?.[0]?.payload ?? job }
    },
    async update(input) {
      const job = input.paperReportJob ?? input
      if (!database?.connected) return { ok: true, disabled: true, job }
      const result = await database.query(
        `UPDATE atlas_paper_report_jobs SET status = $5, lease_owner = $6, lease_expires_at = $7, payload = $8, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND COALESCE(team_workspace_id, '') = COALESCE($3, '') AND account_id = $4
         RETURNING payload`,
        [job.id, job.tenantScope.organizationId, job.tenantScope.teamWorkspaceId ?? '', job.accountId, job.status, job.lease?.owner ?? null, job.lease?.leaseExpiresAt ?? null, job],
      )
      return { ok: true, job: result.rows?.[0]?.payload ?? job }
    },
    async list({ tenantContext = {}, accountId, status, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (status) { params.push(String(status)); clauses.push(`status = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_report_jobs
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => item.payload)
    },
  }
}
