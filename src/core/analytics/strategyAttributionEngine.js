import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluatePaperPerformance } from './paperPerformanceAnalyticsEngine.js'

export const STRATEGY_ATTRIBUTION_EVALUATED_EVENT = 'strategy.attribution.evaluated'

function getStrategyName(record = {}) {
  return String(
    record.strategy
      ?? record.proposedTradeSnapshot?.strategy
      ?? record.proposedTradeSnapshot?.signal
      ?? record.guardrailDecisionSnapshot?.proposedTrade?.strategy
      ?? record.executionSimulationSnapshot?.proposedTrade?.strategy
      ?? 'Unattributed',
  ).trim() || 'Unattributed'
}

function isCompletedPaperTrade(record = {}) {
  return record.paperTrading !== false
    && record.journalStatus === 'recorded'
    && record.fill
    && record.decisionGate?.execution === 'filled'
    && record.decisionGate?.accounting !== 'rejected'
}

function groupByStrategy(records) {
  return records.reduce((groups, record) => {
    const strategy = getStrategyName(record)
    const current = groups.get(strategy) ?? []
    current.push(record)
    groups.set(strategy, current)
    return groups
  }, new Map())
}

export function evaluateStrategyAttribution(journalRecords = [], options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const records = Array.isArray(journalRecords) ? journalRecords : []
  const groupedRecords = groupByStrategy(records)
  const strategies = Array.from(groupedRecords.entries()).map(([strategy, strategyRecords]) => {
    const performance = evaluatePaperPerformance(strategyRecords, { emitEvent: false, timestamp })
    const completedTrades = strategyRecords.filter(isCompletedPaperTrade)

    return {
      strategy,
      trades: performance.metrics.totalTrades,
      totalJournalRecords: strategyRecords.length,
      excludedTrades: performance.excludedTrades,
      winRate: performance.metrics.winRate,
      netRealizedPnl: performance.metrics.netRealizedPnl,
      averageWin: performance.metrics.averageWin,
      averageLoss: performance.metrics.averageLoss,
      profitFactor: performance.metrics.profitFactor,
      expectancy: performance.metrics.expectancy,
      largestWin: performance.metrics.largestWin,
      largestLoss: performance.metrics.largestLoss,
      symbols: [...new Set(completedTrades.map((record) => record.symbol).filter(Boolean))].sort(),
      tradeIds: performance.includedTradeIds,
    }
  }).sort((left, right) => right.netRealizedPnl - left.netRealizedPnl)

  const result = {
    eventType: STRATEGY_ATTRIBUTION_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'evaluated',
    totalJournalRecords: records.length,
    attributedStrategies: strategies.length,
    excludedTrades: strategies.reduce((sum, strategy) => sum + strategy.excludedTrades, 0),
    strategies,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_ATTRIBUTION_EVALUATED_EVENT, result)
  }

  return result
}

export function createStrategyAttributionEngine(options = {}) {
  return {
    evaluate(journalRecords, attributionOptions = {}) {
      return evaluateStrategyAttribution(journalRecords, { ...options, ...attributionOptions })
    },
  }
}
