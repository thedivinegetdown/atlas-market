import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_PORTFOLIO_REALTIME_UPDATED_EVENT = 'paperPortfolio.realtime.updated'
export const REALTIME_PORTFOLIO_STREAMING_STATUSES = Object.freeze(['healthy', 'caution', 'stale', 'blocked'])

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
    status: reference.status ?? reference.reconciliationStatus ?? reference.executionLifecycleStatus ?? null,
  }
}

function latestReconciliation(input = {}) {
  const reconciliations = input.realtimePortfolioReconciliation?.realtimePortfolioReconciliations
    ?? input.reconciliations
    ?? []
  return reconciliations[0] ?? null
}

function getStatus({ reconciliation, timestamp, staleAfterMs }) {
  if (!reconciliation) return 'blocked'
  if (reconciliation.reconciliationStatus === 'blocked') return 'blocked'
  if (reconciliation.reconciliationStatus === 'mismatch') return 'caution'
  const ageMs = Math.abs(new Date(timestamp).getTime() - new Date(reconciliation.updatedAt ?? reconciliation.createdAt ?? timestamp).getTime())
  if (ageMs > staleAfterMs) return 'stale'
  if (reconciliation.reconciliationStatus === 'caution') return 'caution'
  return 'healthy'
}

function summarizePositions(positions = []) {
  const bounded = positions.slice(0, 250)
  return {
    totalOpenPositions: bounded.length,
    positions: bounded.map((position) => ({
      symbol: position.symbol,
      assetType: position.assetType,
      side: position.side,
      quantity: numberValue(position.quantity),
      averagePrice: round(position.averagePrice, 6),
      currentPrice: round(position.currentPrice, 6),
      marketValue: round(position.marketValue),
      unrealizedPnl: round(position.unrealizedPnl),
    })),
  }
}

export function streamRealtimePaperPortfolio(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const reconciliation = latestReconciliation(input)
  const account = reconciliation?.accountSnapshot ?? input.accountSnapshot ?? {}
  const positions = reconciliation?.positionsSnapshot ?? input.positionsSnapshot ?? []
  const staleAfterMs = Math.max(1000, Number(input.streamingPolicy?.staleAfterMs ?? 300000))
  const status = getStatus({ reconciliation, timestamp, staleAfterMs })
  const positionsSummary = summarizePositions(positions)
  const realizedPnl = round(account.realizedPnl)
  const unrealizedPnl = round(positionsSummary.positions.reduce((sum, position) => sum + numberValue(position.unrealizedPnl), 0))
  const grossExposure = round(positionsSummary.positions.reduce((sum, position) => sum + Math.abs(numberValue(position.marketValue)), 0))
  const netExposure = round(positionsSummary.positions.reduce((sum, position) => sum + numberValue(position.marketValue), 0))
  const result = {
    eventType: PAPER_PORTFOLIO_REALTIME_UPDATED_EVENT,
    timestamp,
    tenantScope: normalizeTenantScope(tenantContext),
    accountId: reconciliation?.accountId ?? input.accountId ?? 'paper-portfolio',
    currentCashSummary: {
      cash: round(account.cash),
      source: reconciliation?.latestAccountingReference?.eventType ?? null,
    },
    currentEquitySummary: {
      equity: round(account.equity),
      source: reconciliation?.latestAccountingReference?.eventType ?? null,
    },
    openPositionsSummary: positionsSummary,
    realizedPnlSummary: {
      realizedPnl,
      source: reconciliation?.realizedPnlReconciliation?.status ?? null,
    },
    unrealizedPnlSummary: {
      unrealizedPnl,
      source: 'paper accounting position snapshot',
    },
    exposureSummaryReferences: {
      grossExposure,
      netExposure,
      portfolioAnalyticsReference: normalizeReference(input.portfolioAnalyticsReference ?? input.portfolioAnalytics),
      riskReference: normalizeReference(input.portfolioRiskReference ?? input.portfolioRisk),
    },
    latestReconciliationStatus: reconciliation?.reconciliationStatus ?? 'blocked',
    latestReconciliationReference: normalizeReference(reconciliation ? { id: reconciliation.id, eventType: reconciliation.eventType ?? 'paperPortfolio.realtime.reconciled', status: reconciliation.reconciliationStatus } : null),
    latestSimulatedExecutionReference: normalizeReference(reconciliation?.latestSimulatedExecutionReference ?? input.latestSimulatedExecutionReference),
    streamingPortfolioStatus: status,
    streamingPolicy: {
      staleAfterMs,
      maxPositionsPerSnapshot: 250,
      paginationRequiredForHistory: true,
    },
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time paper portfolio stream ${status}: ${round(account.cash)} cash, ${round(account.equity)} equity, ${positionsSummary.totalOpenPositions} open positions, ${realizedPnl} realized P&L, ${unrealizedPnl} unrealized P&L.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_PORTFOLIO_REALTIME_UPDATED_EVENT, result)
  return result
}

export function createRealtimePaperPortfolioStreamingEngine(options = {}) {
  return {
    stream(input, streamOptions = {}) {
      return streamRealtimePaperPortfolio(input, { ...options, ...streamOptions })
    },
  }
}
