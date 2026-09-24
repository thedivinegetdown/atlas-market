import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { historicalEvidenceUnavailable } from './historicalEvidenceContract.js'

export const STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT = 'strategy.backtestPerformance.evaluated'

export function evaluateBacktestPerformance(input = {}, options = {}) {
  const backtestExecution = input.strategyBacktestExecution ?? input.backtestExecution ?? {}
  const evidence = historicalEvidenceUnavailable()
  // Legacy journal fills and injected aggregate snapshots are not historical
  // evidence. No supported historical executor can currently supply outcomes.
  const result = {
    eventType: STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp: options.timestamp ?? new Date().toISOString(),
    analyticsStatus: 'blocked',
    evidenceStatus: evidence.status,
    historicalEvidence: evidence,
    reason: 'CANONICAL_HISTORICAL_OUTCOMES_UNAVAILABLE',
    totalSimulatedTrades: backtestExecution.simulatedPaperTrades?.length ?? 0,
    includedTrades: 0,
    excludedTrades: backtestExecution.simulatedPaperTrades?.length ?? 0,
    metrics: null,
    returnCurveSummary: null,
    paperPerformanceSnapshot: null,
    riskAdjustedPerformanceSnapshot: null,
    summary: 'Historical performance UNAVAILABLE: legacy fills and aggregate performance cannot establish canonical historical outcomes.',
    sourceEvents: { strategyBacktestExecution: backtestExecution.eventType ?? null },
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT, result)
  return result
}

export function createStrategyBacktestPerformanceAnalyticsEngine(options = {}) {
  return {
    evaluate(input, analyticsOptions = {}) {
      return evaluateBacktestPerformance(input, { ...options, ...analyticsOptions })
    },
  }
}
