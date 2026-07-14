import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_REPORTS_GENERATED_EVENT = 'paperReports.generated'
export const PAPER_REPORT_TYPES = Object.freeze(['portfolio-summary', 'performance-summary', 'trade-history', 'position-history', 'risk-summary', 'reconciliation-summary', 'operations-summary'])

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

function inRange(record = {}, dateRange = {}) {
  const value = record.createdAt ?? record.updatedAt ?? record.timestamp ?? record.executedAt ?? record.closedAt
  if (!value || (!dateRange.from && !dateRange.to)) return true
  const time = new Date(value).getTime()
  const from = dateRange.from ? new Date(dateRange.from).getTime() : Number.NEGATIVE_INFINITY
  const to = dateRange.to ? new Date(dateRange.to).getTime() : Number.POSITIVE_INFINITY
  return Number.isFinite(time) && time >= from && time <= to
}

function paginate(rows = [], pagination = {}) {
  const limit = Math.min(100, Math.max(1, Number(pagination.limit ?? 25)))
  const offset = Math.max(0, Number(pagination.offset ?? 0))
  return {
    rows: rows.slice(offset, offset + limit),
    pagination: { limit, offset, total: rows.length, hasMore: offset + limit < rows.length },
  }
}

function row(id, label, values = {}, timestamp) {
  return { id, label, ...values, timestamp }
}

export function generatePaperTradingReport(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const tenantScope = scope(input)
  const accountId = String(input.accountId ?? 'paper-portfolio')
  const reportType = PAPER_REPORT_TYPES.includes(input.reportType) ? input.reportType : 'portfolio-summary'
  const dateRange = input.dateRange ?? {}
  const journalRecords = (input.journalRecords ?? input.realtimeSimulatedExecutions?.realtimeJournalRecords ?? []).filter((item) => inRange(item, dateRange))
  const positions = input.positions ?? input.realtimePaperPortfolio?.openPositionsSummary?.positions ?? input.realtimePortfolioReconciliation?.realtimePortfolioReconciliations?.[0]?.positionsSnapshot ?? []
  const rows = {
    'portfolio-summary': [
      row('cash', 'Cash', { value: input.realtimePaperPortfolio?.currentCashSummary?.cash ?? input.portfolio?.cash ?? 0 }, timestamp),
      row('equity', 'Equity', { value: input.realtimePaperPortfolio?.currentEquitySummary?.equity ?? input.portfolio?.accountValue ?? 0 }, timestamp),
      row('open-positions', 'Open Positions', { value: input.realtimePaperPortfolio?.openPositionsSummary?.totalOpenPositions ?? positions.length }, timestamp),
    ],
    'performance-summary': [
      row('total-trades', 'Total Trades', { value: input.realtimePaperPerformance?.realtimePaperPerformanceSummary?.totalTrades ?? journalRecords.length }, timestamp),
      row('realized-pnl', 'Realized P&L', { value: input.realtimePaperPortfolio?.realizedPnlSummary?.realizedPnl ?? 0 }, timestamp),
      row('unrealized-pnl', 'Unrealized P&L', { value: input.realtimePaperPortfolio?.unrealizedPnlSummary?.unrealizedPnl ?? 0 }, timestamp),
    ],
    'trade-history': journalRecords.slice(0, 500).map((item, index) => row(item.tradeId ?? item.id ?? `trade-${index + 1}`, item.symbol ?? 'Trade', { status: item.journalStatus ?? item.status, realizedPnl: item.realizedPnl ?? 0 }, item.createdAt ?? timestamp)),
    'position-history': positions.slice(0, 500).map((item, index) => row(`${item.symbol ?? 'position'}-${index + 1}`, item.symbol ?? 'Position', { quantity: item.quantity ?? 0, averagePrice: item.averagePrice ?? 0 }, item.updatedAt ?? timestamp)),
    'risk-summary': [
      row('risk-status', 'Risk Status', { value: input.realtimePaperRisk?.riskStatus ?? input.portfolioRisk?.summary?.riskLevel ?? 'referenced' }, timestamp),
      row('drawdown', 'Drawdown', { value: input.drawdownProtection?.currentDrawdown ?? 0 }, timestamp),
    ],
    'reconciliation-summary': [
      row('reconciliation-status', 'Reconciliation Status', { value: input.realtimePortfolioReconciliation?.reconciliationStatus ?? 'referenced' }, timestamp),
      row('mismatches', 'Mismatches', { value: input.realtimePortfolioReconciliation?.realtimePortfolioReconciliationSummary?.mismatch ?? 0 }, timestamp),
    ],
    'operations-summary': [
      row('operations-status', 'Operations Status', { value: input.realtimePaperOperations?.operationsStatus ?? 'referenced' }, timestamp),
      row('open-alerts', 'Open Alerts', { value: input.paperOperationsAlerts?.paperOperationsAlertSummary?.open ?? input.paperOperationsAlerts?.length ?? 0 }, timestamp),
      row('open-incidents', 'Open Incidents', { value: input.paperOperationsIncidents?.paperOperationsIncidentSummary?.open ?? input.paperOperationsIncidents?.length ?? 0 }, timestamp),
    ],
  }[reportType]
  const paged = paginate(rows, input.pagination)
  const result = {
    eventType: PAPER_REPORTS_GENERATED_EVENT,
    timestamp,
    paperReport: {
      id: String(input.id ?? `paper-report-${reportType}-${accountId}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
      tenantScope,
      accountId,
      reportType,
      dateRange: { from: dateRange.from ?? null, to: dateRange.to ?? null },
      columns: Object.keys(paged.rows[0] ?? { id: '', label: '', value: '' }),
      rows: paged.rows,
      pagination: paged.pagination,
      sourceReferences: [
        input.realtimePaperPortfolio?.eventType,
        input.realtimePaperPerformance?.eventType,
        input.realtimePortfolioReconciliation?.eventType,
        input.realtimePaperOperations?.eventType,
      ].filter(Boolean),
      generatedAt: timestamp,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    },
    reportStatus: tenantScope.organizationId && tenantScope.userId ? 'generated' : 'blocked',
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Paper report ${reportType} generated with ${paged.rows.length} rows from existing snapshots.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_REPORTS_GENERATED_EVENT, result)
  return result
}

export function createPaperReportRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const report = input.paperReport ?? input
      if (!database?.connected) return { ok: true, disabled: true, report }
      const result = await database.query(
        `INSERT INTO atlas_paper_reports
          (id, organization_id, team_workspace_id, account_id, report_type, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [report.id, report.tenantScope.organizationId, report.tenantScope.teamWorkspaceId, report.accountId, report.reportType, report],
      )
      return { ok: true, report: result.rows?.[0]?.payload ?? report }
    },
    async list({ tenantContext = {}, accountId, reportType, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (reportType) { params.push(String(reportType)); clauses.push(`report_type = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_paper_reports
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((item) => item.payload)
    },
  }
}
