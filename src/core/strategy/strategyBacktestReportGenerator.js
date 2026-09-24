import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { historicalEvidenceUnavailable } from './historicalEvidenceContract.js'

export const STRATEGY_BACKTEST_REPORT_GENERATED_EVENT = 'strategy.backtestReport.generated'

export function generateBacktestReport(input = {}, options = {}) {
  const execution = input.strategyBacktestExecution ?? input.backtestExecution ?? {}
  const evidence = historicalEvidenceUnavailable()
  // Do not allow persisted pre-contract reports or injected robust summaries to
  // become historical approval. Monte Carlo resampling alone is not validation.
  const result = {
    eventType: STRATEGY_BACKTEST_REPORT_GENERATED_EVENT,
    paperTrading: true,
    timestamp: options.timestamp ?? new Date().toISOString(),
    evidenceStatus: evidence.status,
    historicalEvidence: evidence,
    strategySummary: { strategyId: execution.session?.strategyId ?? null, backtestExecutionStatus: 'blocked', paperTrading: true },
    backtestPerformanceSummary: { analyticsStatus: 'UNAVAILABLE', netRealizedPnl: null, winRate: null, maxDrawdown: null },
    walkForwardRobustnessSummary: { status: 'UNAVAILABLE', robustnessScore: null, windowCount: 0 },
    monteCarloRiskSummary: { robustnessClassification: 'UNAVAILABLE', probabilityOfProfitability: null, probabilityOfDrawdownBreach: null },
    keyStrengths: [],
    keyWeaknesses: [...evidence.blockers],
    releaseResearchRecommendation: 'UNAVAILABLE',
    normalizedStrategyResearchReport: {
      evidenceStatus: 'UNAVAILABLE',
      releaseResearchRecommendation: 'UNAVAILABLE',
      paperTrading: true,
      liveOrders: false,
      brokerageIntegration: false,
    },
    summary: 'Historical research report UNAVAILABLE: no supported historical execution or independently executed out-of-sample evidence.',
    sourceEvents: {
      strategyBacktestExecution: execution.eventType ?? null,
      strategyBacktestPerformance: (input.strategyBacktestPerformance ?? input.backtestPerformance)?.eventType ?? null,
      strategyWalkForward: (input.strategyWalkForward ?? input.walkForward)?.eventType ?? null,
      strategyMonteCarlo: (input.strategyMonteCarlo ?? input.monteCarloSimulation ?? input.monteCarlo)?.eventType ?? null,
    },
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(STRATEGY_BACKTEST_REPORT_GENERATED_EVENT, result)
  return result
}

export function createStrategyBacktestReportGenerator(options = {}) {
  return {
    generate(input, generationOptions = {}) {
      return generateBacktestReport(input, { ...options, ...generationOptions })
    },
  }
}
