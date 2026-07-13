import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_PORTFOLIO_REALTIME_RECONCILED_EVENT = 'paperPortfolio.realtime.reconciled'
export const REALTIME_RECONCILIATION_STATUSES = Object.freeze(['reconciled', 'caution', 'mismatch', 'blocked'])

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
    status: reference.status ?? reference.executionLifecycleStatus ?? reference.journalStatus ?? null,
  }
}

function safeStatus(status) {
  return REALTIME_RECONCILIATION_STATUSES.includes(status) ? status : 'blocked'
}

function getExecutionId(execution = {}) {
  return execution.id ?? execution.executionSimulationReference?.id ?? execution.executionSimulation?.proposedTrade?.id ?? null
}

function hasTenantContext(tenantContext = {}) {
  return Boolean(tenantContext.organizationId && tenantContext.userId)
}

function isSuccessfulExecution(execution = {}) {
  return execution.executionLifecycleStatus === 'simulated'
    && execution.executionSimulation?.finalStatus === 'filled'
    && execution.accountingUpdate
    && execution.journalRecord
}

function buildPositionKey(position = {}) {
  return `${String(position.symbol ?? '').toUpperCase()}:${String(position.assetType ?? '').toLowerCase()}:${String(position.side ?? 'long').toLowerCase()}`
}

function compareAccount(accounting = {}, expected = {}) {
  const mismatches = []
  const cash = round(accounting.account?.cash)
  const equity = round(accounting.account?.equity)
  const realizedPnl = round(accounting.account?.realizedPnl)
  if (expected.cash != null && Math.abs(cash - round(expected.cash)) > 0.01) mismatches.push('cash mismatch')
  if (expected.equity != null && Math.abs(equity - round(expected.equity)) > 0.01) mismatches.push('equity mismatch')
  if (expected.realizedPnl != null && Math.abs(realizedPnl - round(expected.realizedPnl)) > 0.01) mismatches.push('realized P&L mismatch')
  return {
    cashReconciliation: { status: mismatches.includes('cash mismatch') ? 'mismatch' : 'reconciled', value: cash, expected: expected.cash ?? null },
    equityReconciliation: { status: mismatches.includes('equity mismatch') ? 'mismatch' : 'reconciled', value: equity, expected: expected.equity ?? null },
    realizedPnlReconciliation: { status: mismatches.includes('realized P&L mismatch') ? 'mismatch' : 'reconciled', value: realizedPnl, expected: expected.realizedPnl ?? null },
    mismatches,
  }
}

function comparePositions(accounting = {}, expectedPositions = []) {
  const expectedByKey = new Map(expectedPositions.map((position) => [buildPositionKey(position), position]))
  const mismatches = []
  const positionChecks = (accounting.positions ?? []).slice(0, 250).map((position) => {
    const expected = expectedByKey.get(buildPositionKey(position))
    const quantityStatus = !expected || Math.abs(numberValue(position.quantity) - numberValue(expected.quantity)) <= 0.000001 ? 'reconciled' : 'mismatch'
    const averagePriceStatus = !expected || Math.abs(numberValue(position.averagePrice) - numberValue(expected.averagePrice)) <= 0.000001 ? 'reconciled' : 'mismatch'
    if (quantityStatus === 'mismatch') mismatches.push(`${position.symbol} quantity mismatch`)
    if (averagePriceStatus === 'mismatch') mismatches.push(`${position.symbol} average price mismatch`)
    return {
      symbol: position.symbol,
      assetType: position.assetType,
      side: position.side,
      quantity: numberValue(position.quantity),
      averagePrice: numberValue(position.averagePrice),
      quantityReconciliation: quantityStatus,
      averagePriceReconciliation: averagePriceStatus,
    }
  })
  return { positionChecks, mismatches }
}

export function normalizeRealtimePortfolioReconciliation(input = {}, index = 0) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  return {
    id: String(input.id ?? `realtime-portfolio-reconciliation-${input.accountId ?? 'paper'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: normalizeTenantScope(input),
    accountId: String(input.accountId ?? input.portfolioId ?? 'paper-portfolio').slice(0, 120),
    reconciliationStatus: safeStatus(input.reconciliationStatus ?? input.status),
    cashReconciliation: input.cashReconciliation ?? { status: 'blocked' },
    positionQuantityReconciliation: input.positionQuantityReconciliation ?? { status: 'blocked', positionsChecked: 0 },
    averagePriceReconciliation: input.averagePriceReconciliation ?? { status: 'blocked', positionsChecked: 0 },
    realizedPnlReconciliation: input.realizedPnlReconciliation ?? { status: 'blocked' },
    equityReconciliation: input.equityReconciliation ?? { status: 'blocked' },
    journalAccountingConsistency: input.journalAccountingConsistency ?? { status: 'blocked' },
    duplicateFillProtection: input.duplicateFillProtection ?? { status: 'blocked', duplicateFillsSuppressed: 0 },
    latestSimulatedExecutionReference: normalizeReference(input.latestSimulatedExecutionReference),
    latestAccountingReference: normalizeReference(input.latestAccountingReference),
    latestJournalReference: normalizeReference(input.latestJournalReference),
    accountSnapshot: input.accountSnapshot ?? null,
    positionsSnapshot: (input.positionsSnapshot ?? []).slice(0, 250),
    reconciliationIssues: (input.reconciliationIssues ?? []).slice(0, 20).map(String),
    idempotencyKey: String(input.idempotencyKey ?? input.duplicateSuppressionKey ?? `${input.accountId ?? 'paper'}:${input.latestSimulatedExecutionReference?.id ?? input.id ?? 'snapshot'}`).slice(0, 260),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimePortfolioReconciliationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const reconciliation = normalizeRealtimePortfolioReconciliation(input)
      if (!database?.connected) return { ok: true, disabled: true, reconciliation }
      const result = await database.query(
        `INSERT INTO atlas_realtime_portfolio_reconciliations
          (id, organization_id, team_workspace_id, account_id, reconciliation_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET reconciliation_status = EXCLUDED.reconciliation_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [reconciliation.id, reconciliation.tenantScope.organizationId, reconciliation.tenantScope.teamWorkspaceId, reconciliation.accountId, reconciliation.reconciliationStatus, reconciliation],
      )
      return { ok: true, reconciliation: normalizeRealtimePortfolioReconciliation(result.rows?.[0]?.payload ?? reconciliation) }
    },
    async list({ tenantContext = {}, accountId, reconciliationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) {
        params.push(String(accountId))
        clauses.push(`account_id = $${params.length}`)
      }
      if (reconciliationStatus) {
        params.push(safeStatus(reconciliationStatus))
        clauses.push(`reconciliation_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_portfolio_reconciliations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimePortfolioReconciliation(row.payload))
    },
  }
}

export function reconcileRealtimePortfolio(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const existingKeys = new Set((input.existingReconciliations ?? []).map((item) => item.idempotencyKey))
  const executions = input.realtimeSimulatedExecutions?.realtimeSimulatedExecutions ?? input.executions ?? []
  const successfulExecutions = executions.filter(isSuccessfulExecution).slice(0, 100)
  const rejectedIgnored = executions.filter((execution) => !isSuccessfulExecution(execution)).length
  const reconciliations = []
  let duplicateFillsSuppressed = 0

  if (!hasTenantContext(tenantContext) || !input.accountId) {
    const blocked = normalizeRealtimePortfolioReconciliation({
      tenantContext,
      accountId: input.accountId,
      reconciliationStatus: 'blocked',
      reconciliationIssues: ['tenant and account context are required'],
      timestamp,
    })
    const result = {
      eventType: PAPER_PORTFOLIO_REALTIME_RECONCILED_EVENT,
      timestamp,
      realtimePortfolioReconciliations: [blocked],
      realtimePortfolioReconciliationSummary: { total: 1, reconciled: 0, caution: 0, mismatch: 0, blocked: 1, duplicateFillsSuppressed: 0, rejectedExecutionsIgnored: rejectedIgnored },
      reconciliationStatus: 'blocked',
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      automaticTrading: false,
      summary: 'Real-time portfolio reconciliation blocked: tenant and account context are required.',
    }
    if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_PORTFOLIO_REALTIME_RECONCILED_EVENT, result)
    return result
  }

  for (const execution of successfulExecutions) {
    const accounting = execution.accountingUpdate
    const journal = execution.journalRecord
    const idempotencyKey = `${input.accountId}:${getExecutionId(execution)}:${execution.executionSimulation?.fill?.symbol}:${execution.executionSimulation?.fill?.quantity}:${execution.executionSimulation?.fill?.fillPrice}`
    if (existingKeys.has(idempotencyKey)) {
      duplicateFillsSuppressed += 1
      continue
    }
    const accountComparison = compareAccount(accounting, input.expectedAccountState ?? {})
    const positionComparison = comparePositions(accounting, input.expectedPositions ?? [])
    const consistencyIssues = []
    if (journal?.decisionGate?.accounting === 'rejected') consistencyIssues.push('journal references rejected accounting')
    if (journal?.accountingUpdateSnapshot?.status && journal.accountingUpdateSnapshot.status !== accounting.status) consistencyIssues.push('journal/accounting status mismatch')
    const issues = [...accountComparison.mismatches, ...positionComparison.mismatches, ...consistencyIssues]
    const status = issues.some((issue) => issue.includes('mismatch')) ? 'mismatch'
      : consistencyIssues.length > 0 ? 'caution'
        : 'reconciled'
    reconciliations.push(normalizeRealtimePortfolioReconciliation({
      tenantContext,
      id: `realtime-portfolio-reconciliation-${getExecutionId(execution)}`,
      accountId: input.accountId,
      reconciliationStatus: status,
      cashReconciliation: accountComparison.cashReconciliation,
      positionQuantityReconciliation: {
        status: positionComparison.positionChecks.some((check) => check.quantityReconciliation === 'mismatch') ? 'mismatch' : 'reconciled',
        positionsChecked: positionComparison.positionChecks.length,
      },
      averagePriceReconciliation: {
        status: positionComparison.positionChecks.some((check) => check.averagePriceReconciliation === 'mismatch') ? 'mismatch' : 'reconciled',
        positionsChecked: positionComparison.positionChecks.length,
      },
      realizedPnlReconciliation: accountComparison.realizedPnlReconciliation,
      equityReconciliation: accountComparison.equityReconciliation,
      journalAccountingConsistency: { status: consistencyIssues.length > 0 ? 'caution' : 'reconciled', issues: consistencyIssues },
      duplicateFillProtection: { status: 'reconciled', duplicateFillsSuppressed },
      latestSimulatedExecutionReference: { id: execution.id, eventType: execution.eventType ?? 'paperExecution.realtime.simulated', status: execution.executionLifecycleStatus },
      latestAccountingReference: execution.accountingUpdateReference,
      latestJournalReference: execution.journalRecordReference,
      accountSnapshot: accounting.account,
      positionsSnapshot: accounting.positions ?? [],
      reconciliationIssues: issues,
      idempotencyKey,
      timestamp,
    }, reconciliations.length))
  }

  const summary = {
    total: reconciliations.length,
    reconciled: reconciliations.filter((item) => item.reconciliationStatus === 'reconciled').length,
    caution: reconciliations.filter((item) => item.reconciliationStatus === 'caution').length,
    mismatch: reconciliations.filter((item) => item.reconciliationStatus === 'mismatch').length,
    blocked: reconciliations.filter((item) => item.reconciliationStatus === 'blocked').length,
    duplicateFillsSuppressed,
    rejectedExecutionsIgnored: rejectedIgnored,
  }
  const reconciliationStatus = summary.blocked > 0 ? 'blocked' : summary.mismatch > 0 ? 'mismatch' : summary.caution > 0 ? 'caution' : 'reconciled'
  const result = {
    eventType: PAPER_PORTFOLIO_REALTIME_RECONCILED_EVENT,
    timestamp,
    realtimePortfolioReconciliations: reconciliations,
    realtimePortfolioReconciliationSummary: summary,
    reconciliationStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time portfolio reconciliation ${reconciliationStatus}: ${summary.reconciled} reconciled, ${summary.mismatch} mismatches, ${summary.caution} caution, ${summary.duplicateFillsSuppressed} duplicate fills suppressed.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_PORTFOLIO_REALTIME_RECONCILED_EVENT, result)
  return result
}
