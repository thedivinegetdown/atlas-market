import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { historicalEvidenceUnavailable } from './historicalEvidenceContract.js'

export const STRATEGY_BACKTEST_EXECUTED_EVENT = 'strategy.backtest.executed'

export function executeStrategyBacktest(input = {}, options = {}) {
  const historicalReplay = input.historicalReplay ?? input.marketReplay ?? {}
  const backtestInput = input.strategyBacktestInput ?? input.backtestInput ?? {}
  const evidence = historicalEvidenceUnavailable()
  // A blueprint or a forward exit policy cannot authorize historical execution.
  // In particular, caller-supplied context and availability flags cannot bypass
  // the absent point-in-time data and frozen entry-to-exit contract.
  const result = {
    eventType: STRATEGY_BACKTEST_EXECUTED_EVENT,
    paperTrading: true,
    timestamp: options.timestamp ?? new Date().toISOString(),
    backtestExecutionStatus: 'blocked',
    evidenceStatus: evidence.status,
    historicalEvidence: evidence,
    reason: evidence.blockers[0],
    session: {
      sessionId: historicalReplay.replaySessionConfiguration?.sessionId ?? 'backtest-session',
      strategyId: backtestInput.selectedStrategySnapshot?.strategyId ?? backtestInput.normalizedBacktestRequest?.selectedStrategySnapshot?.strategyId ?? historicalReplay.replaySessionConfiguration?.strategyId ?? null,
      symbol: historicalReplay.replaySessionConfiguration?.symbol ?? null,
      timeframe: historicalReplay.replaySessionConfiguration?.timeframe ?? null,
      consumedCandles: 0,
    },
    replayStepConsumption: [],
    strategyRuleEvaluations: [],
    strategySignalCompositions: [],
    simulatedPaperTrades: [],
    executionSummary: null,
    summary: 'Historical execution UNAVAILABLE: frozen historical strategy, point-in-time evidence, execution timing, and cost contracts are required.',
    sourceEvents: {
      strategyBacktestInput: backtestInput.eventType ?? null,
      historicalReplay: historicalReplay.eventType ?? null,
    },
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(STRATEGY_BACKTEST_EXECUTED_EVENT, result)
  return result
}

export function createStrategyBacktestExecutionEngine(options = {}) {
  return {
    execute(input, executionOptions = {}) {
      return executeStrategyBacktest(input, { ...options, ...executionOptions })
    },
  }
}
