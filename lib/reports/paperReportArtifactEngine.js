import { updatePaperReportDelivery } from './paperReportDeliveryEngine.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_REPORT_ARTIFACT_EVENTS = Object.freeze({
  created: 'paperReportArtifact.created',
  available: 'paperReportArtifact.available',
  downloaded: 'paperReportArtifact.downloaded',
  expired: 'paperReportArtifact.expired',
  failed: 'paperReportArtifact.failed',
})

export const PAPER_REPORT_ARTIFACT_STATUSES = Object.freeze(['pending', 'available', 'expired', 'deleted', 'failed'])

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

function safe(value) {
  return String(value ?? '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'paper-report'
}

function checksum(content) {
  let hash = 2166136261
  const text = String(content ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function publicArtifact(artifact = {}) {
  const safeArtifact = { ...artifact }
  delete safeArtifact.content
  return safeArtifact
}

function eventFor(status) {
  if (status === 'expired') return PAPER_REPORT_ARTIFACT_EVENTS.expired
  if (status === 'failed') return PAPER_REPORT_ARTIFACT_EVENTS.failed
  if (status === 'available') return PAPER_REPORT_ARTIFACT_EVENTS.available
  return PAPER_REPORT_ARTIFACT_EVENTS.created
}

export function createPaperReportArtifact(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const tenantScope = scope(input)
  const exportRecord = input.paperReportExport ?? input.exportRecord ?? {}
  const format = ['csv', 'json'].includes(exportRecord.format ?? input.format) ? (exportRecord.format ?? input.format) : 'csv'
  const content = String(input.content ?? exportRecord.content ?? '')
  const byteSize = content.length
  const maxArtifactBytes = Math.min(5_000_000, Math.max(1, Number(input.maxArtifactBytes ?? options.maxArtifactBytes ?? 1_000_000)))
  const expiresAt = input.expiresAt ?? new Date(new Date(timestamp).getTime() + Math.min(30, Math.max(1, Number(input.retentionDays ?? options.retentionDays ?? 7))) * 24 * 60 * 60 * 1000).toISOString()
  const status = byteSize > maxArtifactBytes ? 'failed' : input.status ?? 'available'
  const artifact = {
    id: String(input.id ?? `paper-report-artifact-${tenantScope.organizationId ?? 'tenant'}-${input.accountId ?? exportRecord.accountId ?? 'paper'}-${exportRecord.id ?? (Date.parse(timestamp) || Date.now())}`).slice(0, 220),
    tenantScope,
    accountId: String(input.accountId ?? exportRecord.accountId ?? 'paper-portfolio'),
    reportId: input.reportId ?? exportRecord.reportId ?? null,
    exportId: input.exportId ?? exportRecord.id ?? null,
    jobId: input.jobId ?? null,
    scheduleId: input.scheduleId ?? null,
    deliveryId: input.deliveryId ?? null,
    format,
    filename: safe(input.filename ?? exportRecord.filename ?? `paper-report.${format}`),
    contentType: format === 'json' ? 'application/json' : 'text/csv',
    byteSize,
    checksum: checksum(content),
    checksumValid: checksum(content) === (input.checksum ?? checksum(content)),
    status,
    downloadCount: Number(input.downloadCount ?? 0),
    lastDownloadedAt: input.lastDownloadedAt ?? null,
    createdAt: timestamp,
    expiresAt,
    content: status === 'available' ? content : '',
    storagePathExposed: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  const result = {
    eventType: eventFor(status),
    timestamp,
    paperReportArtifact: publicArtifact(artifact),
    artifactRecord: artifact,
    artifactStatus: status,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(result.eventType, result)
  return result
}

export function expirePaperReportArtifact(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const artifact = input.artifactRecord ?? input.paperReportArtifact ?? input
  const expired = new Date(artifact.expiresAt ?? 0).getTime() <= new Date(timestamp).getTime()
  const next = expired && artifact.status !== 'deleted'
    ? { ...artifact, status: 'expired', content: '', updatedAt: timestamp }
    : artifact
  const result = {
    eventType: eventFor(next.status),
    timestamp,
    paperReportArtifact: publicArtifact(next),
    artifactRecord: next,
    artifactStatus: next.status,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && expired) (options.eventBus ?? defaultEventBus)?.emit?.(result.eventType, result)
  return result
}

export function downloadPaperReportArtifact(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const artifact = expirePaperReportArtifact(input, { ...options, emitEvent: false, timestamp }).artifactRecord
  const downloadable = artifact.status === 'available' && artifact.content && artifact.checksum === checksum(artifact.content)
  if (!downloadable) {
    return {
      eventType: eventFor(artifact.status),
      timestamp,
      downloadStatus: 'blocked',
      reason: artifact.status === 'available' ? 'integrity_failed' : artifact.status,
      paperReportArtifact: publicArtifact(artifact),
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }
  const downloaded = {
    ...artifact,
    downloadCount: Number(artifact.downloadCount ?? 0) + 1,
    lastDownloadedAt: timestamp,
    updatedAt: timestamp,
  }
  const result = {
    eventType: PAPER_REPORT_ARTIFACT_EVENTS.downloaded,
    timestamp,
    downloadStatus: 'downloaded',
    paperReportArtifact: publicArtifact(downloaded),
    artifactRecord: downloaded,
    content: artifact.content,
    contentType: artifact.contentType,
    headers: {
      'content-type': artifact.contentType,
      'content-disposition': `attachment; filename="${safe(artifact.filename)}"`,
    },
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(PAPER_REPORT_ARTIFACT_EVENTS.downloaded, result)
  return result
}

export function synchronizeDeliveryWithArtifact({ paperReportDelivery, artifactRecord } = {}, options = {}) {
  if (!paperReportDelivery || !artifactRecord) return { synchronized: false, paperReportDelivery }
  const status = artifactRecord.status === 'available' ? 'available' : artifactRecord.status === 'expired' ? 'expired' : artifactRecord.status === 'failed' ? 'failed' : paperReportDelivery.status
  const delivery = updatePaperReportDelivery({
    paperReportDelivery: {
      ...paperReportDelivery,
      exportId: artifactRecord.exportId ?? paperReportDelivery.exportId,
      filename: artifactRecord.filename ?? paperReportDelivery.filename,
      expiresAt: artifactRecord.expiresAt ?? paperReportDelivery.expiresAt,
      deliveryMetadata: {
        ...(paperReportDelivery.deliveryMetadata ?? {}),
        artifactId: artifactRecord.id,
        checksum: artifactRecord.checksum,
        byteSize: artifactRecord.byteSize,
      },
    },
    status,
    tenantContext: artifactRecord.tenantScope,
  }, { ...options, emitEvent: false })
  return { synchronized: true, ...delivery }
}

export function createPaperReportArtifactRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const artifact = input.artifactRecord ?? input
      if (!database?.connected) return { ok: true, disabled: true, artifact }
      const result = await database.query(
        `INSERT INTO atlas_paper_report_artifacts
          (id, organization_id, team_workspace_id, account_id, status, format, report_id, export_id, job_id, schedule_id, delivery_id, expires_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [artifact.id, artifact.tenantScope.organizationId, artifact.tenantScope.teamWorkspaceId, artifact.accountId, artifact.status, artifact.format, artifact.reportId, artifact.exportId, artifact.jobId, artifact.scheduleId, artifact.deliveryId, artifact.expiresAt, artifact],
      )
      return { ok: true, artifact: result.rows?.[0]?.payload ?? artifact }
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
        `SELECT payload FROM atlas_paper_report_artifacts
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY created_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => publicArtifact(item.payload))
    },
    async get({ tenantContext = {}, artifactId } = {}) {
      if (!database?.connected) return null
      const result = await database.query(
        `SELECT payload FROM atlas_paper_report_artifacts
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '') AND id = $3
         LIMIT 1`,
        [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, artifactId],
      )
      return result.rows?.[0]?.payload ?? null
    },
  }
}
