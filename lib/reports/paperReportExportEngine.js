import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_REPORTS_EXPORTED_EVENT = 'paperReports.exported'
export const PAPER_REPORT_EXPORT_FORMATS = Object.freeze(['csv', 'json'])

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

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function exportPaperReport(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const tenantScope = scope(input)
  const format = PAPER_REPORT_EXPORT_FORMATS.includes(input.format) ? input.format : 'csv'
  const report = input.paperReport ?? input.report ?? {}
  const rows = (report.rows ?? []).slice(0, Math.min(1000, Number(input.maxRows ?? 1000)))
  const columns = (report.columns?.length ? report.columns : Object.keys(rows[0] ?? {})).slice(0, 50)
  const content = format === 'json'
    ? JSON.stringify({ report: { ...report, rows }, exportedAt: timestamp }, null, 2)
    : [columns.join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n')
  const filename = `${safe(report.reportType)}-${safe(report.accountId)}-${safe(timestamp)}.${format}`
  const result = {
    eventType: PAPER_REPORTS_EXPORTED_EVENT,
    timestamp,
    paperReportExport: {
      id: String(input.id ?? `paper-report-export-${format}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
      tenantScope,
      accountId: report.accountId ?? input.accountId ?? 'paper-portfolio',
      reportId: report.id ?? null,
      reportType: report.reportType ?? 'portfolio-summary',
      format,
      filename,
      content,
      byteLength: content.length,
      rowCount: rows.length,
      downloadHistorySummary: { latestFilename: filename, totalExports: 1, persisted: false },
      generatedAt: timestamp,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    },
    exportStatus: tenantScope.organizationId && tenantScope.userId ? 'exported' : 'blocked',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Paper report exported as ${format} with ${rows.length} bounded rows.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_REPORTS_EXPORTED_EVENT, result)
  return result
}

export function createPaperReportExportRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const exportRecord = input.paperReportExport ?? input
      if (!database?.connected) return { ok: true, disabled: true, exportRecord }
      const result = await database.query(
        `INSERT INTO atlas_paper_report_exports
          (id, organization_id, team_workspace_id, account_id, report_type, export_format, filename, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [exportRecord.id, exportRecord.tenantScope.organizationId, exportRecord.tenantScope.teamWorkspaceId, exportRecord.accountId, exportRecord.reportType, exportRecord.format, exportRecord.filename, exportRecord],
      )
      return { ok: true, exportRecord: result.rows?.[0]?.payload ?? exportRecord }
    },
    async list({ tenantContext = {}, accountId, reportType, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (reportType) { params.push(String(reportType)); clauses.push(`report_type = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_report_exports
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => item.payload)
    },
  }
}
