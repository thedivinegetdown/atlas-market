import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const TRADE_JOURNAL_RECORDED_EVENT = 'trade.journal.recorded'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function snapshot(value) {
  if (value == null) return null
  return JSON.parse(JSON.stringify(value))
}

function getLifecycleStatus({ proposedTrade, guardrailDecision, executionSimulation, accountingUpdate }) {
  if (!proposedTrade) return { status: 'rejected', reason: 'Missing proposed trade snapshot' }
  if (!guardrailDecision?.approved) return { status: 'rejected', reason: guardrailDecision?.reason ?? 'Guardrail rejected trade' }
  if (executionSimulation?.finalStatus !== 'filled') return { status: 'rejected', reason: executionSimulation?.reason ?? 'Execution was not filled' }
  if (accountingUpdate?.status === 'rejected') return { status: 'rejected', reason: accountingUpdate.reason ?? 'Accounting update rejected lifecycle' }
  return { status: 'recorded', reason: 'Paper trade lifecycle recorded' }
}

function buildEventChain({ guardrailDecision, executionSimulation, accountingUpdate }) {
  return [
    guardrailDecision?.eventType ? {
      eventType: guardrailDecision.eventType,
      status: guardrailDecision.decision,
      timestamp: guardrailDecision.timestamp,
    } : null,
    executionSimulation?.eventType ? {
      eventType: executionSimulation.eventType,
      status: executionSimulation.finalStatus,
      timestamp: executionSimulation.timestamp,
    } : null,
    accountingUpdate?.eventType ? {
      eventType: accountingUpdate.eventType,
      status: accountingUpdate.status,
      timestamp: accountingUpdate.timestamp,
    } : null,
    {
      eventType: TRADE_JOURNAL_RECORDED_EVENT,
      status: 'emitted',
      timestamp: null,
    },
  ].filter(Boolean)
}

function buildRiskMetricsSnapshot(guardrailDecision = {}, accountingUpdate = {}) {
  return {
    tradeRiskPct: round(guardrailDecision.metrics?.riskPct),
    portfolioHeatAfterTrade: round(guardrailDecision.metrics?.portfolioHeatAfterTrade),
    requiredCapital: round(guardrailDecision.metrics?.marginRequirement),
    currentPortfolioRiskLevel: guardrailDecision.currentPortfolioRisk?.riskLevel ?? null,
    currentPortfolioRiskScore: guardrailDecision.currentPortfolioRisk?.riskScore ?? null,
    cashAfterAccounting: round(accountingUpdate.account?.cash),
    equityAfterAccounting: round(accountingUpdate.account?.equity),
  }
}

export function recordPaperTradeJournal({
  proposedTrade,
  guardrailDecision,
  executionSimulation,
  accountingUpdate,
} = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const lifecycleStatus = getLifecycleStatus({
    proposedTrade,
    guardrailDecision,
    executionSimulation,
    accountingUpdate,
  })
  const fill = executionSimulation?.fill ?? null
  const symbol = normalizeSymbol(proposedTrade?.symbol ?? guardrailDecision?.proposedTrade?.symbol ?? fill?.symbol)
  const eventChain = buildEventChain({ guardrailDecision, executionSimulation, accountingUpdate })
  const record = {
    eventType: TRADE_JOURNAL_RECORDED_EVENT,
    paperTrading: true,
    journalStatus: lifecycleStatus.status,
    status: lifecycleStatus.status,
    reason: lifecycleStatus.reason,
    timestamp,
    tradeId: proposedTrade?.id ?? `${symbol || 'paper'}-${timestamp}`,
    portfolioId: accountingUpdate?.portfolioId ?? executionSimulation?.portfolioId ?? guardrailDecision?.portfolioId ?? 'paper-portfolio',
    symbol,
    side: proposedTrade?.side ?? fill?.side ?? null,
    quantity: numberValue(proposedTrade?.quantity ?? fill?.quantity),
    assetType: proposedTrade?.assetType ?? fill?.assetType ?? null,
    fill: fill ? {
      fillPrice: round(fill.fillPrice, 6),
      fees: round(fill.fees),
      slippageBps: round(fill.slippageBps),
      notional: round(fill.notional),
      cashImpact: round(fill.cashImpact),
    } : null,
    realizedPnl: round(accountingUpdate?.account?.realizedPnlDelta),
    decisionGate: {
      guardrail: guardrailDecision?.decision ?? 'missing',
      execution: executionSimulation?.finalStatus ?? 'missing',
      accounting: accountingUpdate?.status ?? 'missing',
    },
    proposedTradeSnapshot: snapshot(proposedTrade ?? guardrailDecision?.proposedTrade),
    guardrailDecisionSnapshot: snapshot(guardrailDecision),
    executionSimulationSnapshot: snapshot(executionSimulation),
    accountingUpdateSnapshot: snapshot(accountingUpdate),
    riskMetricsSnapshot: buildRiskMetricsSnapshot(guardrailDecision, accountingUpdate),
    eventChain,
  }

  record.eventChain = eventChain.map((event) => (
    event.eventType === TRADE_JOURNAL_RECORDED_EVENT
      ? { ...event, status: record.journalStatus, timestamp }
      : event
  ))

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(TRADE_JOURNAL_RECORDED_EVENT, record)
  }

  return record
}

export function createPaperTradeJournalEngine(options = {}) {
  return {
    record(lifecycle, journalOptions = {}) {
      return recordPaperTradeJournal(lifecycle, { ...options, ...journalOptions })
    },
  }
}
