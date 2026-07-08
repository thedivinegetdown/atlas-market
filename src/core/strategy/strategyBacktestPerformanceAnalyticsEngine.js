import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluatePaperPerformance } from '../analytics/paperPerformanceAnalyticsEngine.js'
import { evaluateRiskAdjustedPerformance } from '../analytics/riskAdjustedPerformanceEngine.js'

export const STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT = 'strategy.backtestPerformance.evaluated'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getBacktestExecution(input = {}) {
  return input.strategyBacktestExecution ?? input.backtestExecution ?? {}
}

function getJournalRecords(backtestExecution = {}) {
  return (backtestExecution.simulatedPaperTrades ?? [])
    .map((trade) => trade.journalRecord)
    .filter(Boolean)
}

function getStartingEquity(input = {}, backtestExecution = {}) {
  return numberValue(
    input.startingEquity
      ?? input.strategyBacktestInput?.initialCapitalConfiguration?.initialCapital
      ?? input.strategyBacktestInput?.normalizedBacktestRequest?.initialCapitalConfiguration?.initialCapital
      ?? backtestExecution.simulatedPaperTrades?.[0]?.accountingUpdate?.account?.equity,
    100000,
  )
}

function summarizeReturnCurve(riskAdjustedPerformance = {}, startingEquity = 100000) {
  const returnSeries = riskAdjustedPerformance.returnSeries ?? []
  const endingEquity = returnSeries.at(-1)?.endingEquity ?? startingEquity

  return {
    startingEquity: round(startingEquity),
    endingEquity: round(endingEquity),
    totalReturnPct: startingEquity > 0 ? round(((endingEquity - startingEquity) / startingEquity) * 100, 4) : 0,
    points: returnSeries.map((point) => ({
      tradeId: point.tradeId,
      endingEquity: point.endingEquity,
      returnPct: point.returnPct,
    })),
  }
}

function buildBlockedResult({ input, timestamp, reason }) {
  const backtestExecution = getBacktestExecution(input)
  return {
    eventType: STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    analyticsStatus: 'blocked',
    reason,
    totalSimulatedTrades: backtestExecution.simulatedPaperTrades?.length ?? 0,
    includedTrades: 0,
    excludedTrades: backtestExecution.simulatedPaperTrades?.length ?? 0,
    metrics: {
      totalSimulatedTrades: backtestExecution.simulatedPaperTrades?.length ?? 0,
      totalIncludedTrades: 0,
      winRate: 0,
      netRealizedPnl: 0,
      averageWin: 0,
      averageLoss: 0,
      profitFactor: 0,
      expectancy: 0,
      maxDrawdown: 0,
    },
    returnCurveSummary: summarizeReturnCurve({}, getStartingEquity(input, backtestExecution)),
    paperPerformanceSnapshot: null,
    riskAdjustedPerformanceSnapshot: null,
    summary: `Backtest performance analytics blocked: ${reason}.`,
    sourceEvents: {
      strategyBacktestExecution: backtestExecution.eventType ?? null,
    },
  }
}

export function evaluateBacktestPerformance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const backtestExecution = getBacktestExecution(input)

  if (backtestExecution.backtestExecutionStatus === 'blocked') {
    return buildBlockedResult({ input, timestamp, reason: 'Backtest execution is blocked' })
  }

  const journalRecords = getJournalRecords(backtestExecution)
  const startingEquity = getStartingEquity(input, backtestExecution)
  const paperPerformanceSnapshot = input.paperPerformanceSnapshot
    ?? evaluatePaperPerformance(journalRecords, { emitEvent: false, timestamp })
  const riskAdjustedPerformanceSnapshot = input.riskAdjustedPerformanceSnapshot
    ?? evaluateRiskAdjustedPerformance(journalRecords, {
      emitEvent: false,
      timestamp,
      startingEquity,
      performanceSnapshot: paperPerformanceSnapshot,
    })
  const totalSimulatedTrades = backtestExecution.simulatedPaperTrades?.length ?? 0
  const totalIncludedTrades = paperPerformanceSnapshot.metrics?.totalTrades ?? 0
  const excludedTrades = paperPerformanceSnapshot.excludedTrades ?? totalSimulatedTrades - totalIncludedTrades
  const returnCurveSummary = summarizeReturnCurve(riskAdjustedPerformanceSnapshot, startingEquity)
  const analyticsStatus = backtestExecution.backtestExecutionStatus === 'completed' ? 'evaluated' : 'caution'
  const result = {
    eventType: STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    analyticsStatus,
    backtestExecutionStatus: backtestExecution.backtestExecutionStatus ?? 'unknown',
    totalSimulatedTrades,
    includedTrades: totalIncludedTrades,
    excludedTrades,
    excludedReason: paperPerformanceSnapshot.excludedReason,
    metrics: {
      totalSimulatedTrades,
      totalIncludedTrades,
      winRate: round(paperPerformanceSnapshot.metrics?.winRate),
      netRealizedPnl: round(paperPerformanceSnapshot.metrics?.netRealizedPnl),
      averageWin: round(paperPerformanceSnapshot.metrics?.averageWin),
      averageLoss: round(paperPerformanceSnapshot.metrics?.averageLoss),
      profitFactor: round(paperPerformanceSnapshot.metrics?.profitFactor),
      expectancy: round(paperPerformanceSnapshot.metrics?.expectancy),
      maxDrawdown: round(riskAdjustedPerformanceSnapshot.metrics?.maxDrawdown, 4),
    },
    returnCurveSummary,
    paperPerformanceSnapshot,
    riskAdjustedPerformanceSnapshot,
    summary: `Backtest performance ${analyticsStatus}: ${totalIncludedTrades} included trades, ${excludedTrades} excluded, ${round(paperPerformanceSnapshot.metrics?.netRealizedPnl)} net realized P&L.`,
    sourceEvents: {
      strategyBacktestExecution: backtestExecution.eventType ?? null,
      paperPerformance: paperPerformanceSnapshot.eventType ?? null,
      riskAdjustedPerformance: riskAdjustedPerformanceSnapshot.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT, result)
  }

  return result
}

export function createStrategyBacktestPerformanceAnalyticsEngine(options = {}) {
  return {
    evaluate(input, analyticsOptions = {}) {
      return evaluateBacktestPerformance(input, { ...options, ...analyticsOptions })
    },
  }
}
