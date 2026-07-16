import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_REPORT_DELIVERY_EVENTS = Object.freeze({
  available: 'paperReportDelivery.available',
  delivered: 'paperReportDelivery.delivered',
  failed: 'paperReportDelivery.failed',
  expired: 'paperReportDelivery.expired',
})

export const PAPER_REPORT_DELIVERY_STATUSES = Object.freeze(['pending', 'available', 'delivered', 'failed', 'expired'])

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

function eventFor(status) {
  if (status === 'delivered') return PAPER_REPORT_DELIVERY_EVENTS.delivered
  if (status === 'failed') return PAPER_REPORT_DELIVERY_EVENTS.failed
  if (status === 'expired') return PAPER_REPORT_DELIVERY_EVENTS.expired
  return PAPER_REPORT_DELIVERY_EVENTS.available
}

export function createPaperReportDelivery(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const tenantScope = scope(input)
  const exportRecord = input.paperReportExport ?? input.exportRecord ?? {}
  const accountId = String(input.accountId ?? exportRecord.accountId ?? 'paper-portfolio')
  const filename = safe(input.filename ?? exportRecord.filename ?? `${exportRecord.reportType ?? 'paper-report'}-${accountId}.${exportRecord.format ?? 'csv'}`)
  const expiresAt = input.expiresAt ?? new Date(new Date(timestamp).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const delivery = {
    id: String(input.id ?? `paper-report-delivery-${tenantScope.organizationId ?? 'tenant'}-${accountId}-${exportRecord.id ?? (Date.parse(timestamp) || Date.now())}`).slice(0, 220),
    tenantScope,
    accountId,
    reportId: input.reportId ?? exportRecord.reportId ?? null,
    exportId: input.exportId ?? exportRecord.id ?? null,
    filename,
    format: exportRecord.format ?? input.format ?? 'csv',
    status: input.status ?? 'available',
    downloadAvailable: input.status !== 'expired' && input.status !== 'failed',
    deliveryMetadata: {
      byteLength: Math.min(10_000_000, Number(exportRecord.byteLength ?? input.byteLength ?? 0)),
      rowCount: Math.min(1000, Number(exportRecord.rowCount ?? input.rowCount ?? 0)),
      channel: input.channel ?? 'download',
    },
    history: [{
      status: input.status ?? 'available',
      at: timestamp,
      actor: tenantScope.userId,
      eventType: eventFor(input.status ?? 'available'),
    }],
    expiresAt,
    createdAt: timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  const result = {
    eventType: eventFor(delivery.status),
    timestamp,
    paperReportDelivery: delivery,
    deliveryStatus: tenantScope.organizationId && tenantScope.userId ? delivery.status : 'failed',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(result.eventType, result)
  return result
}

export function updatePaperReportDelivery(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const current = input.paperReportDelivery ?? input.currentDelivery ?? input
  const requestedStatus = PAPER_REPORT_DELIVERY_STATUSES.includes(input.status) ? input.status : current.status
  const expired = new Date(current.expiresAt ?? 0).getTime() <= new Date(timestamp).getTime()
  const status = expired && requestedStatus !== 'delivered' ? 'expired' : requestedStatus
  const delivery = {
    ...current,
    status,
    downloadAvailable: status === 'available' || status === 'delivered',
    deliveredAt: status === 'delivered' ? (current.deliveredAt ?? timestamp) : current.deliveredAt ?? null,
    failedAt: status === 'failed' ? (current.failedAt ?? timestamp) : current.failedAt ?? null,
    expiredAt: status === 'expired' ? (current.expiredAt ?? timestamp) : current.expiredAt ?? null,
    updatedAt: timestamp,
    history: [...(current.history ?? []), { status, at: timestamp, actor: scope(input).userId ?? current.tenantScope?.userId, eventType: eventFor(status), reason: input.reason ?? null }].slice(-50),
  }
  const result = { eventType: eventFor(status), timestamp, paperReportDelivery: delivery, deliveryStatus: status, paperTrading: true, liveOrders: false, brokerExecution: false }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(result.eventType, result)
  return result
}

export function validatePaperReportDownload(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const delivery = input.paperReportDelivery ?? input
  const expired = new Date(delivery.expiresAt ?? 0).getTime() <= new Date(timestamp).getTime()
  const available = !expired && ['available', 'delivered'].includes(delivery.status) && delivery.downloadAvailable !== false
  return {
    valid: available,
    reason: available ? 'available' : expired ? 'expired' : 'not_available',
    safeFilename: safe(delivery.filename),
    checkedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createPaperReportDeliveryRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const delivery = input.paperReportDelivery ?? input
      if (!database?.connected) return { ok: true, disabled: true, delivery }
      const result = await database.query(
        `INSERT INTO atlas_paper_report_deliveries
          (id, organization_id, team_workspace_id, account_id, status, expires_at, filename, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [delivery.id, delivery.tenantScope.organizationId, delivery.tenantScope.teamWorkspaceId, delivery.accountId, delivery.status, delivery.expiresAt, delivery.filename, delivery],
      )
      return { ok: true, delivery: result.rows?.[0]?.payload ?? delivery }
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
        `SELECT payload FROM atlas_paper_report_deliveries
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => item.payload)
    },
  }
}
