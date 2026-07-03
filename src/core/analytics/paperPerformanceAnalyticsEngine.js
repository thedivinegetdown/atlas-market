import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const PORTFOLIO_PERFORMANCE_EVALUATED_EVENT = 'portfolio.performance.evaluated'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function isCompletedPaperTrade(record = {}) {
  return record.paperTrading !== false
    && record.journalStatus === 'recorded'
    && record.fill
    && record.decisionGate?.execution === 'filled'
    && record.decisionGate?.accounting !== 'rejected'
}

function getRealizedPnl(record = {}) {
  return numberValue(record.realizedPnl ?? record.accountingUpdateSnapshot?.account?.realizedPnlDelta)
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function evaluatePaperPerformance(journalRecords = [], options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const records = Array.isArray(journalRecords) ? journalRecords : []
  const includedTrades = records.filter(isCompletedPaperTrade)
  const pnlValues = includedTrades.map(getRealizedPnl)
  const wins = pnlValues.filter((value) => value > 0)
  const losses = pnlValues.filter((value) => value < 0)
  const grossProfit = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0))
  const totalTrades = includedTrades.length
  const netRealizedPnl = pnlValues.reduce((sum, value) => sum + value, 0)
  const result = {
    eventType: PORTFOLIO_PERFORMANCE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'evaluated',
    totalJournalRecords: records.length,
    excludedTrades: records.length - totalTrades,
    excludedReason: 'Rejected, non-filled, or incomplete paper lifecycle records are excluded',
    metrics: {
      totalTrades,
      winRate: totalTrades > 0 ? round((wins.length / totalTrades) * 100) : 0,
      averageWin: round(average(wins)),
      averageLoss: round(average(losses)),
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : (grossProfit > 0 ? 999 : 0),
      netRealizedPnl: round(netRealizedPnl),
      largestWin: wins.length > 0 ? round(Math.max(...wins)) : 0,
      largestLoss: losses.length > 0 ? round(Math.min(...losses)) : 0,
      expectancy: totalTrades > 0 ? round(netRealizedPnl / totalTrades) : 0,
    },
    includedTradeIds: includedTrades.map((record) => record.tradeId),
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_PERFORMANCE_EVALUATED_EVENT, result)
  }

  return result
}

export function createPaperPerformanceAnalyticsEngine(options = {}) {
  return {
    evaluate(journalRecords, analyticsOptions = {}) {
      return evaluatePaperPerformance(journalRecords, { ...options, ...analyticsOptions })
    },
  }
}
