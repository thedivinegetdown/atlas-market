import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluatePaperPerformance } from './paperPerformanceAnalyticsEngine.js'

export const PORTFOLIO_RISK_ADJUSTED_PERFORMANCE_EVALUATED_EVENT = 'portfolio.riskAdjustedPerformance.evaluated'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values) {
  if (values.length === 0) return 0
  const mean = average(values)
  const variance = average(values.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

function getRealizedPnl(record = {}) {
  return numberValue(record.realizedPnl ?? record.accountingUpdateSnapshot?.account?.realizedPnlDelta)
}

function getTradeId(record = {}, index) {
  return record.tradeId ?? record.id ?? `trade-${index + 1}`
}

function buildIncludedRecords(records, performanceSnapshot) {
  const includedTradeIds = new Set(performanceSnapshot.includedTradeIds ?? [])

  return records.filter((record, index) => includedTradeIds.has(getTradeId(record, index)))
}

function buildReturnSeries(records, startingEquity) {
  let equity = Math.max(0, numberValue(startingEquity, 100000))

  return records.map((record, index) => {
    const previousEquity = equity
    const realizedPnl = getRealizedPnl(record)
    const returnPct = previousEquity > 0 ? (realizedPnl / previousEquity) * 100 : 0
    equity = previousEquity + realizedPnl

    return {
      tradeId: getTradeId(record, index),
      symbol: record.symbol ?? record.proposedTradeSnapshot?.symbol ?? 'N/A',
      realizedPnl: round(realizedPnl),
      startingEquity: round(previousEquity),
      endingEquity: round(equity),
      returnPct: round(returnPct, 4),
    }
  })
}

function calculateDrawdowns(returnSeries, startingEquity) {
  let peak = Math.max(0, numberValue(startingEquity, 100000))
  let maxDrawdown = 0
  let maxDrawdownAmount = 0
  const drawdowns = returnSeries.map((point) => {
    peak = Math.max(peak, point.endingEquity)
    const drawdownAmount = Math.max(0, peak - point.endingEquity)
    const drawdownPct = peak > 0 ? (drawdownAmount / peak) * 100 : 0
    maxDrawdown = Math.max(maxDrawdown, drawdownPct)
    maxDrawdownAmount = Math.max(maxDrawdownAmount, drawdownAmount)

    return {
      tradeId: point.tradeId,
      equity: point.endingEquity,
      drawdownPct: round(drawdownPct, 4),
    }
  })

  return {
    drawdowns,
    maxDrawdown: round(maxDrawdown, 4),
    averageDrawdown: round(average(drawdowns.map((point) => point.drawdownPct)), 4),
    maxDrawdownAmount: round(maxDrawdownAmount),
  }
}

function calculateRecoveryFactor(netRealizedPnl, maxDrawdownAmount) {
  if (maxDrawdownAmount > 0) {
    return round(netRealizedPnl / maxDrawdownAmount)
  }

  return netRealizedPnl > 0 ? 999 : 0
}

function calculateGrade({ sharpeStyleScore, sortinoStyleDownsideScore, maxDrawdown, netRealizedPnl }) {
  if (netRealizedPnl < 0 && (maxDrawdown > 25 || sharpeStyleScore < -1)) return 'F'
  if (netRealizedPnl < 0 || maxDrawdown > 18) return 'D'
  if (sharpeStyleScore >= 1.5 && sortinoStyleDownsideScore >= 1.5 && maxDrawdown <= 5) return 'A'
  if (sharpeStyleScore >= 1 && maxDrawdown <= 10) return 'B'
  if (sharpeStyleScore >= 0 && maxDrawdown <= 15) return 'C'
  return 'D'
}

export function evaluateRiskAdjustedPerformance(journalRecords = [], options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const records = Array.isArray(journalRecords) ? journalRecords : []
  const startingEquity = Math.max(0, numberValue(options.startingEquity, 100000))
  const riskFreeReturn = numberValue(options.riskFreeReturn, 0)
  const performanceSnapshot = options.performanceSnapshot
    ?? evaluatePaperPerformance(records, { emitEvent: false, timestamp })
  const includedRecords = buildIncludedRecords(records, performanceSnapshot)
  const returnSeries = buildReturnSeries(includedRecords, startingEquity)
  const returns = returnSeries.map((point) => point.returnPct)
  const excessReturns = returns.map((value) => value - riskFreeReturn)
  const downsideReturns = excessReturns.filter((value) => value < 0)
  const averageReturn = average(excessReturns)
  const volatilityEstimate = standardDeviation(excessReturns)
  const downsideDeviation = standardDeviation(downsideReturns)
  const periodScale = Math.sqrt(Math.max(1, returns.length))
  const sharpeStyleScore = volatilityEstimate > 0 ? (averageReturn / volatilityEstimate) * periodScale : 0
  const sortinoStyleDownsideScore = downsideDeviation > 0
    ? (averageReturn / downsideDeviation) * periodScale
    : (averageReturn > 0 ? 999 : 0)
  const drawdown = calculateDrawdowns(returnSeries, startingEquity)
  const netRealizedPnl = numberValue(performanceSnapshot.metrics?.netRealizedPnl)
  const recoveryFactor = calculateRecoveryFactor(netRealizedPnl, drawdown.maxDrawdownAmount)
  const riskAdjustedGrade = calculateGrade({
    sharpeStyleScore,
    sortinoStyleDownsideScore,
    maxDrawdown: drawdown.maxDrawdown,
    netRealizedPnl,
  })

  const result = {
    eventType: PORTFOLIO_RISK_ADJUSTED_PERFORMANCE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'evaluated',
    startingEquity: round(startingEquity),
    totalJournalRecords: records.length,
    includedTrades: includedRecords.length,
    excludedTrades: performanceSnapshot.excludedTrades ?? records.length - includedRecords.length,
    excludedReason: performanceSnapshot.excludedReason,
    metrics: {
      totalTrades: performanceSnapshot.metrics?.totalTrades ?? includedRecords.length,
      netRealizedPnl: round(netRealizedPnl),
      averageReturn: round(average(returns), 4),
      volatilityEstimate: round(volatilityEstimate, 4),
      sharpeStyleScore: round(sharpeStyleScore),
      sortinoStyleDownsideScore: round(sortinoStyleDownsideScore),
      maxDrawdown: drawdown.maxDrawdown,
      averageDrawdown: drawdown.averageDrawdown,
      recoveryFactor,
      riskAdjustedGrade,
    },
    returnSeries,
    drawdownSeries: drawdown.drawdowns,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_RISK_ADJUSTED_PERFORMANCE_EVALUATED_EVENT, result)
  }

  return result
}

export function createRiskAdjustedPerformanceEngine(options = {}) {
  return {
    evaluate(journalRecords, analyticsOptions = {}) {
      return evaluateRiskAdjustedPerformance(journalRecords, { ...options, ...analyticsOptions })
    },
  }
}
