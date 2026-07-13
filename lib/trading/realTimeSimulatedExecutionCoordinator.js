import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { simulateTradeExecution } from '../../src/core/execution/executionSimulationEngine.js'
import { applyPaperPortfolioAccounting } from '../../src/core/accounting/paperPortfolioAccountingEngine.js'
import { recordPaperTradeJournal } from '../../src/core/journal/paperTradeJournalEngine.js'

export const PAPER_EXECUTION_REALTIME_SIMULATED_EVENT = 'paperExecution.realtime.simulated'
export const PAPER_ACCOUNTING_REALTIME_UPDATED_EVENT = 'paperAccounting.realtime.updated'
export const PAPER_JOURNAL_REALTIME_RECORDED_EVENT = 'paperJournal.realtime.recorded'
export const REALTIME_EXECUTION_LIFECYCLE_STATUSES = Object.freeze(['simulated', 'rejected', 'cancelled', 'failed'])

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

function normalizeReference(reference = {}) {
  if (!reference) return null
  return {
    id: reference.id ?? null,
    eventType: reference.eventType ?? reference.type ?? null,
    status: reference.status ?? reference.executionLifecycleStatus ?? reference.finalStatus ?? reference.decision ?? null,
  }
}

function safeStatus(status) {
  return REALTIME_EXECUTION_LIFECYCLE_STATUSES.includes(status) ? status : 'rejected'
}

function hasUnsafeMode(input = {}) {
  return input.paperTrading === false || input.liveOrders === true || input.brokerExecution === true || input.accountMode === 'live' || input.executionMode === 'live'
}

function guardrailFromPrepared(preparedTrade = {}) {
  const proposedTrade = preparedTrade.proposedPaperTrade ?? {}
  const approved = preparedTrade.preparationStatus === 'ready' && preparedTrade.guardrailEvaluation?.guardrailApproved === true
  return {
    eventType: preparedTrade.tradeGuardrailReference?.eventType ?? 'trade.guardrail.evaluated',
    paperTrading: true,
    timestamp: preparedTrade.updatedAt ?? preparedTrade.createdAt,
    portfolioId: 'paper-portfolio',
    proposedTrade,
    approved,
    decision: approved ? 'approved' : 'rejected',
    reason: approved ? 'Prepared paper trade passed guardrail reference' : preparedTrade.preparationBlockers?.[0] ?? 'Prepared trade is not ready for simulation',
    metrics: {
      marginRequirement: preparedTrade.buyingPowerValidation?.requiredCapital ?? 0,
      portfolioHeatAfterTrade: preparedTrade.portfolioHeatValidation?.portfolioHeatAfterTrade ?? 0,
      maxPortfolioHeatPct: preparedTrade.portfolioHeatValidation?.maxPortfolioHeatPct ?? 0,
      riskPct: 0,
    },
  }
}

function quoteForTrade(preparedTrade = {}, input = {}) {
  const trade = preparedTrade.proposedPaperTrade ?? {}
  const quote = input.quote ?? input.marketQuote ?? {}
  const price = Number(trade.price ?? quote.last ?? quote.price ?? 100)
  return {
    symbol: trade.symbol,
    last: quote.last ?? quote.price ?? price,
    bid: quote.bid ?? price,
    ask: quote.ask ?? price,
    high: quote.high ?? price,
    low: quote.low ?? price,
    liquidityScore: quote.liquidityScore ?? 75,
    timestamp: quote.timestamp ?? getNowIso(),
  }
}

export function normalizeRealtimeSimulatedExecution(input = {}, index = 0) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const status = safeStatus(input.executionLifecycleStatus ?? input.status)
  return {
    id: String(input.id ?? `realtime-simulated-execution-${input.symbol ?? 'SPY'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: normalizeTenantScope(input),
    symbol: String(input.symbol ?? input.executionSimulation?.proposedTrade?.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(input.assetType ?? input.executionSimulation?.proposedTrade?.assetType ?? 'etf').toLowerCase().slice(0, 40),
    executionLifecycleStatus: status,
    sourcePreparedTradeReference: normalizeReference(input.sourcePreparedTradeReference),
    sourceDecisionReference: normalizeReference(input.sourceDecisionReference),
    sourceAlertReference: normalizeReference(input.sourceAlertReference),
    executionSimulationReference: normalizeReference(input.executionSimulationReference),
    accountingUpdateReference: normalizeReference(input.accountingUpdateReference),
    journalRecordReference: normalizeReference(input.journalRecordReference),
    executionSimulation: input.executionSimulation ?? null,
    accountingUpdate: input.accountingUpdate ?? null,
    journalRecord: input.journalRecord ?? null,
    slippageModelReference: input.slippageModelReference ?? { model: 'executionSimulationEngine.defaultSlippageModel' },
    feeModelReference: input.feeModelReference ?? { model: 'executionSimulationEngine.defaultFeeModel' },
    rejectionReason: input.rejectionReason ?? null,
    duplicateSuppressionKey: String(input.duplicateSuppressionKey ?? `${input.symbol ?? 'SPY'}:${input.sourcePreparedTradeReference?.id ?? input.id ?? 'prepared'}`).slice(0, 260),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimeSimulatedExecutionRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const execution = normalizeRealtimeSimulatedExecution(input)
      if (!database?.connected) return { ok: true, disabled: true, execution }
      const result = await database.query(
        `INSERT INTO atlas_realtime_simulated_executions
          (id, organization_id, team_workspace_id, execution_status, symbol, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET execution_status = EXCLUDED.execution_status, symbol = EXCLUDED.symbol, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [execution.id, execution.tenantScope.organizationId, execution.tenantScope.teamWorkspaceId, execution.executionLifecycleStatus, execution.symbol, execution],
      )
      return { ok: true, execution: normalizeRealtimeSimulatedExecution(result.rows?.[0]?.payload ?? execution) }
    },
    async list({ tenantContext = {}, executionStatus, symbol, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (executionStatus) {
        params.push(safeStatus(executionStatus))
        clauses.push(`execution_status = $${params.length}`)
      }
      if (symbol) {
        params.push(String(symbol).toUpperCase())
        clauses.push(`symbol = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_simulated_executions
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimeSimulatedExecution(row.payload))
    },
  }
}

export function simulateRealtimePaperExecution(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const preparedTrades = input.realtimePreparedTrades?.realtimePreparedTrades ?? input.preparedTrades ?? []
  const existingKeys = new Set((input.existingExecutions ?? []).map((execution) => execution.duplicateSuppressionKey))
  const alertsBySignalId = new Map((input.realtimeAlerts?.realtimeAlerts ?? input.alerts ?? [])
    .map((alert) => [alert.sourceSignalReference?.id, alert]))
  const executions = []
  const accountingUpdates = []
  const journalRecords = []
  let duplicateSuppressed = 0

  for (const preparedTrade of preparedTrades.slice(0, 100)) {
    const suppressionKey = `${preparedTrade.symbol}:${preparedTrade.id}:${preparedTrade.preparationStatus}`
    if (existingKeys.has(suppressionKey)) {
      duplicateSuppressed += 1
      continue
    }
    const unsafeMode = hasUnsafeMode(input) || hasUnsafeMode(preparedTrade) || hasUnsafeMode(preparedTrade.proposedPaperTrade)
    let executionSimulation = null
    let accountingUpdate = null
    let journalRecord = null
    let executionLifecycleStatus = 'rejected'
    let rejectionReason = null
    if (unsafeMode) {
      rejectionReason = 'paper-mode invariant failed'
    } else if (preparedTrade.preparationStatus !== 'ready') {
      rejectionReason = preparedTrade.preparationBlockers?.[0] ?? 'prepared trade is not ready'
    } else {
      const guardrailDecision = guardrailFromPrepared(preparedTrade)
      executionSimulation = simulateTradeExecution(guardrailDecision, quoteForTrade(preparedTrade, input), { emitEvent: false, timestamp })
      if (executionSimulation.finalStatus === 'filled') {
        accountingUpdate = applyPaperPortfolioAccounting(input.portfolio ?? {}, executionSimulation, { emitEvent: false, timestamp })
        if (accountingUpdate.status !== 'rejected') {
          journalRecord = recordPaperTradeJournal({
            proposedTrade: preparedTrade.proposedPaperTrade,
            guardrailDecision,
            executionSimulation,
            accountingUpdate,
          }, { emitEvent: false, timestamp })
          executionLifecycleStatus = journalRecord.journalStatus === 'recorded' ? 'simulated' : 'failed'
        } else {
          executionLifecycleStatus = 'failed'
          rejectionReason = accountingUpdate.reason
        }
      } else {
        executionLifecycleStatus = executionSimulation.finalStatus === 'not_filled' ? 'cancelled' : 'rejected'
        rejectionReason = executionSimulation.reason
      }
    }
    if (accountingUpdate && accountingUpdate.status !== 'rejected') accountingUpdates.push({ ...accountingUpdate, eventType: PAPER_ACCOUNTING_REALTIME_UPDATED_EVENT })
    if (journalRecord && journalRecord.journalStatus === 'recorded') journalRecords.push({ ...journalRecord, eventType: PAPER_JOURNAL_REALTIME_RECORDED_EVENT })
    const alert = alertsBySignalId.get(preparedTrade.sourceDecisionReference?.id?.replace(/^realtime-paper-decision-/, ''))
    executions.push(normalizeRealtimeSimulatedExecution({
      tenantContext,
      id: `realtime-simulated-execution-${preparedTrade.id}`,
      symbol: preparedTrade.symbol,
      assetType: preparedTrade.assetType,
      executionLifecycleStatus,
      sourcePreparedTradeReference: { id: preparedTrade.id, eventType: preparedTrade.eventType ?? 'paperTrade.realtime.prepared', status: preparedTrade.preparationStatus },
      sourceDecisionReference: preparedTrade.sourceDecisionReference,
      sourceAlertReference: alert ? { id: alert.id, eventType: alert.eventType ?? 'alerts.realtime.created', status: alert.lifecycle } : null,
      executionSimulationReference: executionSimulation ? { id: `execution-${preparedTrade.id}`, eventType: executionSimulation.eventType, status: executionSimulation.finalStatus } : null,
      accountingUpdateReference: accountingUpdate ? { id: `accounting-${preparedTrade.id}`, eventType: accountingUpdate.eventType, status: accountingUpdate.status } : null,
      journalRecordReference: journalRecord ? { id: journalRecord.tradeId, eventType: journalRecord.eventType, status: journalRecord.journalStatus } : null,
      executionSimulation,
      accountingUpdate: accountingUpdate && accountingUpdate.status !== 'rejected' ? accountingUpdate : null,
      journalRecord: journalRecord && journalRecord.journalStatus === 'recorded' ? journalRecord : null,
      rejectionReason,
      duplicateSuppressionKey: suppressionKey,
      timestamp,
    }, executions.length))
  }

  const realtimeSimulatedExecutionSummary = {
    total: executions.length,
    simulated: executions.filter((item) => item.executionLifecycleStatus === 'simulated').length,
    rejected: executions.filter((item) => item.executionLifecycleStatus === 'rejected').length,
    cancelled: executions.filter((item) => item.executionLifecycleStatus === 'cancelled').length,
    failed: executions.filter((item) => item.executionLifecycleStatus === 'failed').length,
    accountingUpdates: accountingUpdates.length,
    journalRecords: journalRecords.length,
    duplicateSuppressed,
  }
  const executionOperationsStatus = realtimeSimulatedExecutionSummary.failed > 0 ? 'failed'
    : realtimeSimulatedExecutionSummary.simulated > 0 ? 'simulated'
      : realtimeSimulatedExecutionSummary.cancelled > 0 ? 'cancelled'
        : 'rejected'
  const result = {
    eventType: PAPER_EXECUTION_REALTIME_SIMULATED_EVENT,
    timestamp,
    realtimeSimulatedExecutions: executions,
    realtimeAccountingUpdates: accountingUpdates,
    realtimeJournalRecords: journalRecords,
    realtimeSimulatedExecutionSummary,
    executionOperationsStatus,
    paperModeInvariant: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time simulated execution ${executionOperationsStatus}: ${realtimeSimulatedExecutionSummary.simulated} simulated fills, ${realtimeSimulatedExecutionSummary.accountingUpdates} accounting updates, and ${realtimeSimulatedExecutionSummary.journalRecords} journal records.`,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PAPER_EXECUTION_REALTIME_SIMULATED_EVENT, result)
    eventBus.emit(PAPER_ACCOUNTING_REALTIME_UPDATED_EVENT, accountingUpdates)
    eventBus.emit(PAPER_JOURNAL_REALTIME_RECORDED_EVENT, journalRecords)
  }
  return result
}
