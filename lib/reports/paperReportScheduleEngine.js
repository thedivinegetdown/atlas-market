import { queuePaperReportJob } from './paperReportJobEngine.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_REPORT_SCHEDULE_EVENTS = Object.freeze({
  created: 'paperReportSchedule.created',
  updated: 'paperReportSchedule.updated',
  triggered: 'paperReportSchedule.triggered',
  disabled: 'paperReportSchedule.disabled',
})

export const PAPER_REPORT_FREQUENCIES = Object.freeze(['daily', 'weekly', 'monthly'])

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

function addFrequency(date, frequency) {
  const next = new Date(date)
  if (frequency === 'weekly') next.setUTCDate(next.getUTCDate() + 7)
  else if (frequency === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export function calculateNextReportRun({ from = new Date(), frequency = 'daily', timezone = 'UTC' } = {}) {
  const start = new Date(from)
  const safeFrequency = PAPER_REPORT_FREQUENCIES.includes(frequency) ? frequency : 'daily'
  const next = addFrequency(Number.isNaN(start.getTime()) ? new Date() : start, safeFrequency)
  return {
    nextRunAt: next.toISOString(),
    timezone: String(timezone || 'UTC').slice(0, 80),
    frequency: safeFrequency,
  }
}

export function createPaperReportSchedule(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const tenantScope = scope(input)
  const frequency = PAPER_REPORT_FREQUENCIES.includes(input.frequency) ? input.frequency : 'daily'
  const accountId = String(input.accountId ?? 'paper-portfolio')
  const nextRun = calculateNextReportRun({ from: input.startAt ?? timestamp, frequency, timezone: input.timezone ?? 'UTC' })
  const schedule = {
    id: String(input.id ?? `paper-report-schedule-${tenantScope.organizationId ?? 'tenant'}-${accountId}-${input.reportType ?? 'operations-summary'}-${frequency}`).slice(0, 220),
    tenantScope,
    accountId,
    reportType: input.reportType ?? 'operations-summary',
    format: ['csv', 'json'].includes(input.format) ? input.format : 'csv',
    frequency,
    timezone: nextRun.timezone,
    enabled: input.enabled !== false,
    status: input.enabled === false ? 'disabled' : 'active',
    nextRunAt: input.nextRunAt ?? nextRun.nextRunAt,
    lastRunAt: input.lastRunAt ?? null,
    lastOccurrenceKey: input.lastOccurrenceKey ?? null,
    boundedCatchupLimit: Math.min(7, Math.max(1, Number(input.boundedCatchupLimit ?? 2))),
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  const result = {
    eventType: PAPER_REPORT_SCHEDULE_EVENTS.created,
    timestamp,
    paperReportSchedule: schedule,
    scheduleStatus: tenantScope.organizationId && tenantScope.userId ? schedule.status : 'blocked',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_SCHEDULE_EVENTS.created, result)
  return result
}

export function updatePaperReportSchedule(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const current = input.paperReportSchedule ?? input.currentSchedule ?? input
  const updates = input.updates ?? input
  const nextFrequency = PAPER_REPORT_FREQUENCIES.includes(updates.frequency) ? updates.frequency : current.frequency
  const nextRun = updates.nextRunAt ? { nextRunAt: updates.nextRunAt, timezone: updates.timezone ?? current.timezone, frequency: nextFrequency } : calculateNextReportRun({ from: current.lastRunAt ?? timestamp, frequency: nextFrequency, timezone: updates.timezone ?? current.timezone })
  const schedule = {
    ...current,
    ...updates,
    frequency: nextFrequency,
    format: ['csv', 'json'].includes(updates.format) ? updates.format : current.format,
    nextRunAt: nextRun.nextRunAt,
    status: updates.enabled === false ? 'disabled' : current.status === 'disabled' && updates.enabled !== true ? 'disabled' : 'active',
    enabled: updates.enabled ?? current.enabled,
    updatedAt: timestamp,
  }
  const eventType = schedule.enabled === false ? PAPER_REPORT_SCHEDULE_EVENTS.disabled : PAPER_REPORT_SCHEDULE_EVENTS.updated
  const result = { eventType, timestamp, paperReportSchedule: schedule, scheduleStatus: schedule.status, paperTrading: true, liveOrders: false, brokerExecution: false }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(eventType, result)
  return result
}

export function triggerDuePaperReportSchedule(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const schedule = input.paperReportSchedule ?? input
  if (schedule.enabled === false || schedule.status === 'disabled') {
    return { eventType: PAPER_REPORT_SCHEDULE_EVENTS.disabled, timestamp, paperReportSchedule: schedule, triggered: false, reason: 'disabled' }
  }
  const due = new Date(schedule.nextRunAt ?? 0).getTime() <= new Date(timestamp).getTime()
  if (!due) return { eventType: PAPER_REPORT_SCHEDULE_EVENTS.updated, timestamp, paperReportSchedule: schedule, triggered: false, reason: 'not_due' }
  const occurrenceKey = `${schedule.id}:${schedule.nextRunAt}`
  if (schedule.lastOccurrenceKey === occurrenceKey) return { eventType: PAPER_REPORT_SCHEDULE_EVENTS.triggered, timestamp, paperReportSchedule: schedule, triggered: false, duplicateSuppressed: true }
  const job = queuePaperReportJob({
    tenantContext: schedule.tenantScope,
    accountId: schedule.accountId,
    jobType: schedule.format ? 'export-generation' : 'report-generation',
    reportType: schedule.reportType,
    format: schedule.format,
    idempotencyKey: occurrenceKey,
  }, { ...options, emitEvent: false })
  const nextRun = calculateNextReportRun({ from: schedule.nextRunAt ?? timestamp, frequency: schedule.frequency, timezone: schedule.timezone })
  const updatedSchedule = {
    ...schedule,
    lastRunAt: timestamp,
    lastOccurrenceKey: occurrenceKey,
    nextRunAt: nextRun.nextRunAt,
    updatedAt: timestamp,
  }
  const result = {
    eventType: PAPER_REPORT_SCHEDULE_EVENTS.triggered,
    timestamp,
    paperReportSchedule: updatedSchedule,
    paperReportJob: job.paperReportJob,
    triggered: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_SCHEDULE_EVENTS.triggered, result)
  return result
}

export function createPaperReportScheduleRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const schedule = input.paperReportSchedule ?? input
      if (!database?.connected) return { ok: true, disabled: true, schedule }
      const result = await database.query(
        `INSERT INTO atlas_paper_report_schedules
          (id, organization_id, team_workspace_id, account_id, status, frequency, next_run_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, frequency = EXCLUDED.frequency, next_run_at = EXCLUDED.next_run_at, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [schedule.id, schedule.tenantScope.organizationId, schedule.tenantScope.teamWorkspaceId, schedule.accountId, schedule.status, schedule.frequency, schedule.nextRunAt, schedule],
      )
      return { ok: true, schedule: result.rows?.[0]?.payload ?? schedule }
    },
    async update(input) {
      return this.create(input)
    },
    async list({ tenantContext = {}, accountId, status, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (status) { params.push(String(status)); clauses.push(`status = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_report_schedules
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY next_run_at ASC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => item.payload)
    },
  }
}
