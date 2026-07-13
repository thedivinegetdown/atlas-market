import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_OPERATIONS_REALTIME_EVALUATED_EVENT = 'paperOperations.realtime.evaluated'
export const REALTIME_PAPER_OPERATIONS_STATUSES = Object.freeze(['healthy', 'caution', 'degraded', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
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

function section(id, label, status, details = {}) {
  return { id, label, status, ...details }
}

function normalizeStatus(status) {
  if (['blocked', 'failed'].includes(status)) return 'blocked'
  if (['elevated', 'mismatch', 'degraded'].includes(status)) return 'degraded'
  if (['caution', 'stale', 'watchlist', 'cancelled', 'rejected'].includes(status)) return 'caution'
  return 'healthy'
}

function rollup(sections) {
  if (sections.some((item) => item.status === 'blocked')) return 'blocked'
  if (sections.some((item) => item.status === 'degraded')) return 'degraded'
  if (sections.some((item) => item.status === 'caution')) return 'caution'
  return 'healthy'
}

export function createRealtimePaperOperationsRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const operations = {
        ...input,
        id: String(input.id ?? `realtime-paper-operations-${Date.parse(input.timestamp ?? new Date()) || Date.now()}`).slice(0, 220),
        tenantScope: normalizeTenantScope(input),
      }
      if (!database?.connected) return { ok: true, disabled: true, operations }
      const result = await database.query(
        `INSERT INTO atlas_realtime_paper_operations_snapshots
          (id, organization_id, team_workspace_id, operations_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET operations_status = EXCLUDED.operations_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [operations.id, operations.tenantScope.organizationId, operations.tenantScope.teamWorkspaceId, operations.operationsStatus, operations],
      )
      return { ok: true, operations: result.rows?.[0]?.payload ?? operations }
    },
    async list({ tenantContext = {}, operationsStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (operationsStatus) {
        params.push(String(operationsStatus))
        clauses.push(`operations_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_paper_operations_snapshots
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return result.rows?.map((row) => row.payload) ?? []
    },
  }
}

export function evaluateRealtimePaperOperations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const sections = [
    section('scanner-alerts', 'Scanner, signal, and alert pipeline', normalizeStatus(input.realtimeAlerts?.alertPipelineStatus ?? input.realtimeSignals?.signalEvaluationStatus), {
      alertsCreated: input.realtimeAlerts?.realtimeAlertSummary?.total ?? 0,
    }),
    section('paper-decisions', 'Paper decision coordination', normalizeStatus(input.realtimePaperDecisions?.decisionEvaluationStatus), {
      approved: input.realtimePaperDecisions?.realtimePaperDecisionSummary?.approved ?? 0,
    }),
    section('trade-preparation', 'Sizing and guardrail preparation', normalizeStatus(input.realtimePreparedTrades?.preparationStatus), {
      ready: input.realtimePreparedTrades?.realtimePreparedTradeSummary?.ready ?? 0,
      blocked: input.realtimePreparedTrades?.realtimePreparedTradeSummary?.blocked ?? 0,
    }),
    section('simulated-execution', 'Simulated execution lifecycle', normalizeStatus(input.realtimeSimulatedExecutions?.executionOperationsStatus), {
      simulated: input.realtimeSimulatedExecutions?.realtimeSimulatedExecutionSummary?.simulated ?? 0,
    }),
    section('portfolio-reconciliation', 'Portfolio reconciliation', normalizeStatus(input.realtimePortfolioReconciliation?.reconciliationStatus), {
      reconciled: input.realtimePortfolioReconciliation?.realtimePortfolioReconciliationSummary?.reconciled ?? 0,
      mismatches: input.realtimePortfolioReconciliation?.realtimePortfolioReconciliationSummary?.mismatch ?? 0,
    }),
    section('portfolio-stream', 'Portfolio and P&L stream', normalizeStatus(input.realtimePaperPortfolio?.streamingPortfolioStatus), {
      openPositions: input.realtimePaperPortfolio?.openPositionsSummary?.totalOpenPositions ?? 0,
    }),
    section('risk-monitor', 'Real-time paper risk monitor', normalizeStatus(input.realtimePaperRisk?.riskStatus), {
      issueCount: input.realtimePaperRisk?.realtimePaperRiskSummary?.issueCount ?? 0,
    }),
    section('performance-stream', 'Real-time performance stream', normalizeStatus(input.realtimePaperPerformance?.performanceStatus), {
      totalTrades: input.realtimePaperPerformance?.realtimePaperPerformanceSummary?.totalTrades ?? 0,
    }),
  ]
  if (!tenantContext.organizationId || !tenantContext.userId) sections.push(section('tenant-context', 'Tenant context', 'blocked'))
  const operationsStatus = rollup(sections)
  const result = {
    eventType: PAPER_OPERATIONS_REALTIME_EVALUATED_EVENT,
    timestamp,
    tenantScope: normalizeTenantScope(tenantContext),
    realtimePaperOperationsSections: sections,
    realtimePaperOperationsSummary: {
      operationsStatus,
      healthy: sections.filter((item) => item.status === 'healthy').length,
      caution: sections.filter((item) => item.status === 'caution').length,
      degraded: sections.filter((item) => item.status === 'degraded').length,
      blocked: sections.filter((item) => item.status === 'blocked').length,
    },
    operationsStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time paper operations ${operationsStatus}: scanner, decision, guardrail, execution, reconciliation, portfolio, risk, and performance streams evaluated.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_OPERATIONS_REALTIME_EVALUATED_EVENT, result)
  return result
}
