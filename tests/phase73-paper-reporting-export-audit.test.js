import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { generatePaperTradingReport, createPaperReportRepository, PAPER_REPORTS_GENERATED_EVENT } from '../lib/reports/paperTradingReportingEngine.js'
import { exportPaperReport, createPaperReportExportRepository, PAPER_REPORTS_EXPORTED_EVENT } from '../lib/reports/paperReportExportEngine.js'
import { generatePaperAuditReport, createPaperAuditRepository, PAPER_AUDIT_GENERATED_EVENT } from '../lib/reports/paperAuditReportingEngine.js'
import { createPaperReportsHandler } from '../netlify/functions/paper-reports.js'
import { createPaperReportExportHandler } from '../netlify/functions/paper-report-export.js'
import { createPaperAuditHandler } from '../netlify/functions/paper-audit.js'

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
      'x-request-id': 'req-phase73',
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
  const realtimeSimulatedExecutions = {
    realtimeSimulatedExecutions: [{ id: 'exec-1', executionLifecycleStatus: 'simulated', createdAt: '2026-07-13T10:00:00.000Z' }],
    realtimeJournalRecords: [{ id: 'journal-1', tradeId: 'trade-1', symbol: 'SPY', journalStatus: 'recorded', realizedPnl: 12, createdAt: '2026-07-13T10:01:00.000Z' }],
  }
  return {
    tenantContext,
    accountId: 'paper-portfolio',
    realtimePaperPortfolio: { eventType: 'paperPortfolio.realtime.updated', currentCashSummary: { cash: 99900 }, currentEquitySummary: { equity: 100020 }, openPositionsSummary: { totalOpenPositions: 1 }, realizedPnlSummary: { realizedPnl: 12 }, unrealizedPnlSummary: { unrealizedPnl: 20 } },
    realtimePaperPerformance: { eventType: 'paperPerformance.realtime.updated', realtimePaperPerformanceSummary: { totalTrades: 1 } },
    realtimePortfolioReconciliation: { eventType: 'paperPortfolio.realtime.reconciled', reconciliationStatus: 'reconciled', realtimePortfolioReconciliations: [{ id: 'recon-1', reconciliationStatus: 'reconciled' }], realtimePortfolioReconciliationSummary: { mismatch: 0 } },
    realtimePaperRisk: { riskStatus: 'healthy' },
    realtimePaperOperations: { operationsStatus: 'healthy' },
    paperOperationsAlerts: { paperOperationsAlertSummary: { open: 1 }, paperOperationsAlerts: [{ id: 'alert-1', status: 'open' }] },
    paperOperationsIncidents: { paperOperationsIncidentSummary: { open: 1 }, paperOperationsIncidents: [{ id: 'incident-1', incidentState: 'open', activityRecords: [{ actor: { userId } }] }] },
    paperOperationsObservability: { healthStatus: 'healthy' },
    apiReliability: { failureRate: 0, successRate: 1 },
    realtimeSimulatedExecutions,
  }
}

describe('Phase 73A paper trading reporting', () => {
  it('creates idempotent report/export/audit persistence and uses parameterized access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_reports')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_report_exports')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_paper_audit_reports')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createPaperReportRepository, createPaperReportExportRepository, createPaperAuditRepository]) {
      const query = vi.fn(async () => ({ rows: [] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ id: 'record-1', tenantScope: tenantContext, accountId: 'paper-portfolio', reportType: 'portfolio-summary', format: 'csv', filename: 'safe.csv' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('generates snapshot reports with date filtering, empty dataset support, and pagination', () => {
    const report = generatePaperTradingReport({ ...fixture(), reportType: 'trade-history', dateRange: { from: '2026-07-13T10:00:00.000Z', to: '2026-07-13T10:30:00.000Z' }, pagination: { limit: 1 } }, { emitEvent: false })
    const empty = generatePaperTradingReport({ ...fixture(), reportType: 'trade-history', dateRange: { from: '2026-07-12T00:00:00.000Z', to: '2026-07-12T23:59:59.000Z' } }, { emitEvent: false })
    expect(report.eventType).toBe(PAPER_REPORTS_GENERATED_EVENT)
    expect(report.paperReport.rows).toHaveLength(1)
    expect(report.paperReport.pagination.hasMore).toBe(false)
    expect(empty.paperReport.rows).toHaveLength(0)
    expect(report.liveOrders).toBe(false)
  })
})

describe('Phase 73B export framework', () => {
  it('exports valid CSV and JSON with safe filenames and bounded rows', () => {
    const report = generatePaperTradingReport({ ...fixture(), reportType: 'portfolio-summary' }, { emitEvent: false }).paperReport
    const csv = exportPaperReport({ tenantContext, paperReport: report, format: 'csv' }, { emitEvent: false })
    const json = exportPaperReport({ tenantContext, paperReport: report, format: 'json' }, { emitEvent: false })
    expect(csv.eventType).toBe(PAPER_REPORTS_EXPORTED_EVENT)
    expect(csv.paperReportExport.content.split('\n')[0]).toContain('id,label')
    expect(csv.paperReportExport.filename).toMatch(/portfolio-summary-paper-portfolio-.+\.csv/)
    expect(JSON.parse(json.paperReportExport.content).report.rows.length).toBe(report.rows.length)
    expect(JSON.stringify(csv)).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey|rawToken|credential|secret/i)
  })
})

describe('Phase 73C audit reporting APIs', () => {
  it('generates compact read-only audit summaries', () => {
    const audit = generatePaperAuditReport(fixture(), { emitEvent: false })
    expect(audit.eventType).toBe(PAPER_AUDIT_GENERATED_EVENT)
    expect(audit.paperAuditReport.executionAudit.total).toBe(1)
    expect(audit.paperAuditReport.reconciliationAudit.total).toBe(1)
    expect(audit.paperAuditReport.alertHistory.total).toBe(1)
    expect(audit.paperAuditReport.appendOnly).toBe(true)
    expect(audit.paperAuditReport.liveOrders).toBe(false)
  })

  it('serves tenant-scoped report/export/audit APIs with viewer read-only, analyst generation, and cross-tenant denial', async () => {
    const options = { ...fixture(), database: { connected: false }, organizationMembershipRepository: membershipRepository('viewer') }
    const reportRead = parseResponse(await createPaperReportsHandler(options)(authEvent('GET', {}, 'viewer')))
    const exportRead = parseResponse(await createPaperReportExportHandler(options)(authEvent('GET', {}, 'viewer')))
    const auditRead = parseResponse(await createPaperAuditHandler(options)(authEvent('GET', {}, 'viewer')))
    const viewerDenied = parseResponse(await createPaperReportsHandler(options)(authEvent('POST', { reportType: 'portfolio-summary' }, 'viewer')))
    const analystWrite = parseResponse(await createPaperReportExportHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { reportType: 'portfolio-summary', format: 'json' }, 'analyst')))
    const crossTenant = parseResponse(await createPaperAuditHandler(options)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect([reportRead.statusCode, exportRead.statusCode, auditRead.statusCode]).toEqual([200, 200, 200])
    expect(viewerDenied.statusCode).toBe(403)
    expect(analystWrite.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
