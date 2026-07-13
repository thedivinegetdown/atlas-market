import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { evaluatePaperPerformance } from '../../src/core/analytics/paperPerformanceAnalyticsEngine.js'

export const PAPER_PERFORMANCE_REALTIME_UPDATED_EVENT = 'paperPerformance.realtime.updated'
export const REALTIME_PAPER_PERFORMANCE_STATUSES = Object.freeze(['healthy', 'caution', 'stale', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeTenantScope(input = {}) {
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenantScope.userId ?? input.userId ?? null,
    role: tenantScope.role ?? input.role ?? null,
  }
}

function normalizeReference(reference = {}) {
  if (!reference) return null
  return {
    id: reference.id ?? null,
    eventType: reference.eventType ?? reference.type ?? null,
    status: reference.status ?? reference.streamingPortfolioStatus ?? reference.reconciliationStatus ?? null,
  }
}

function resolveStatus({ tenantContext, portfolioStream, performanceSnapshot, stale }) {
  if (!tenantContext.organizationId || !tenantContext.userId || !portfolioStream || !performanceSnapshot) return 'blocked'
  if (stale) return 'stale'
  if (portfolioStream.streamingPortfolioStatus !== 'healthy') return 'caution'
  return 'healthy'
}

export function normalizeRealtimePaperPerformanceSnapshot(input = {}, index = 0) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  return {
    id: String(input.id ?? `realtime-paper-performance-${input.accountId ?? 'paper'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: normalizeTenantScope(input),
    accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
    performanceStatus: REALTIME_PAPER_PERFORMANCE_STATUSES.includes(input.performanceStatus ?? input.status) ? (input.performanceStatus ?? input.status) : 'blocked',
    currentEquitySummary: input.currentEquitySummary ?? { equity: 0 },
    realizedPnlSummary: input.realizedPnlSummary ?? { realizedPnl: 0 },
    unrealizedPnlSummary: input.unrealizedPnlSummary ?? { unrealizedPnl: 0 },
    tradePerformanceSummary: input.tradePerformanceSummary ?? { totalTrades: 0, winRate: 0, expectancy: 0 },
    riskAdjustedPerformanceReference: normalizeReference(input.riskAdjustedPerformanceReference),
    latestPortfolioReference: normalizeReference(input.latestPortfolioReference),
    latestReconciliationReference: normalizeReference(input.latestReconciliationReference),
    latestJournalReferences: (input.latestJournalReferences ?? []).slice(0, 25).map(normalizeReference),
    performanceIssues: (input.performanceIssues ?? []).slice(0, 20).map(String),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimePaperPerformanceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const performance = normalizeRealtimePaperPerformanceSnapshot(input)
      if (!database?.connected) return { ok: true, disabled: true, performance }
      const result = await database.query(
        `INSERT INTO atlas_realtime_paper_performance_snapshots
          (id, organization_id, team_workspace_id, account_id, performance_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET performance_status = EXCLUDED.performance_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [performance.id, performance.tenantScope.organizationId, performance.tenantScope.teamWorkspaceId, performance.accountId, performance.performanceStatus, performance],
      )
      return { ok: true, performance: normalizeRealtimePaperPerformanceSnapshot(result.rows?.[0]?.payload ?? performance) }
    },
    async list({ tenantContext = {}, accountId, performanceStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) {
        params.push(String(accountId))
        clauses.push(`account_id = $${params.length}`)
      }
      if (performanceStatus) {
        params.push(String(performanceStatus))
        clauses.push(`performance_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_paper_performance_snapshots
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimePaperPerformanceSnapshot(row.payload))
    },
  }
}

export function streamRealtimePaperPerformance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const portfolioStream = input.realtimePaperPortfolio
  const reconciliation = input.realtimePortfolioReconciliation?.realtimePortfolioReconciliations?.[0] ?? input.reconciliation
  const journalRecords = input.realtimeJournalRecords ?? input.realtimeSimulatedExecutions?.realtimeJournalRecords ?? []
  const performanceSnapshot = input.performanceSnapshot ?? evaluatePaperPerformance(journalRecords, { emitEvent: false, timestamp })
  const staleAfterMs = Math.max(1000, Number(input.streamingPolicy?.staleAfterMs ?? 300000))
  const ageMs = reconciliation ? Math.abs(new Date(timestamp).getTime() - new Date(reconciliation.updatedAt ?? reconciliation.createdAt ?? timestamp).getTime()) : staleAfterMs + 1
  const performanceStatus = resolveStatus({ tenantContext, portfolioStream, performanceSnapshot, stale: ageMs > staleAfterMs })
  const performance = normalizeRealtimePaperPerformanceSnapshot({
    tenantContext,
    accountId: input.accountId ?? portfolioStream?.accountId ?? reconciliation?.accountId,
    performanceStatus,
    currentEquitySummary: portfolioStream?.currentEquitySummary ?? { equity: 0 },
    realizedPnlSummary: portfolioStream?.realizedPnlSummary ?? { realizedPnl: 0 },
    unrealizedPnlSummary: portfolioStream?.unrealizedPnlSummary ?? { unrealizedPnl: 0 },
    tradePerformanceSummary: {
      totalTrades: performanceSnapshot.metrics?.totalTrades ?? 0,
      winRate: round(performanceSnapshot.metrics?.winRate),
      expectancy: round(performanceSnapshot.metrics?.expectancy),
      netRealizedPnl: round(performanceSnapshot.metrics?.netRealizedPnl),
      excludedTrades: performanceSnapshot.excludedTrades ?? 0,
    },
    riskAdjustedPerformanceReference: normalizeReference(input.riskAdjustedPerformance),
    latestPortfolioReference: portfolioStream ? { id: portfolioStream.accountId, eventType: portfolioStream.eventType, status: portfolioStream.streamingPortfolioStatus } : null,
    latestReconciliationReference: reconciliation ? { id: reconciliation.id, eventType: reconciliation.eventType ?? 'paperPortfolio.realtime.reconciled', status: reconciliation.reconciliationStatus } : null,
    latestJournalReferences: journalRecords.slice(0, 25).map((record) => ({ id: record.tradeId, eventType: record.eventType, status: record.journalStatus })),
    performanceIssues: performanceStatus === 'blocked' ? ['tenant, portfolio, or performance context missing'] : [],
    timestamp,
  })
  const result = {
    eventType: PAPER_PERFORMANCE_REALTIME_UPDATED_EVENT,
    timestamp,
    realtimePaperPerformanceSnapshot: performance,
    realtimePaperPerformanceSummary: {
      performanceStatus,
      totalTrades: performance.tradePerformanceSummary.totalTrades,
      realizedPnl: performance.realizedPnlSummary.realizedPnl,
      unrealizedPnl: performance.unrealizedPnlSummary.unrealizedPnl,
    },
    performanceStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time paper performance stream ${performanceStatus}: ${performance.tradePerformanceSummary.totalTrades} trades, ${performance.realizedPnlSummary.realizedPnl} realized P&L, ${performance.unrealizedPnlSummary.unrealizedPnl} unrealized P&L.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_PERFORMANCE_REALTIME_UPDATED_EVENT, result)
  return result
}
