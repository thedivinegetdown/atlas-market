import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_BACKTEST_REPORT_GENERATED_EVENT = 'strategy.backtestReport.generated'

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

function getBacktestPerformance(input = {}) {
  return input.strategyBacktestPerformance ?? input.backtestPerformance ?? {}
}

function getWalkForward(input = {}) {
  return input.strategyWalkForward ?? input.walkForward ?? {}
}

function getMonteCarlo(input = {}) {
  return input.strategyMonteCarlo ?? input.monteCarloSimulation ?? input.monteCarlo ?? {}
}

function buildStrategySummary(backtestExecution = {}) {
  const session = backtestExecution.session ?? {}
  const executionSummary = backtestExecution.executionSummary ?? {}

  return {
    strategyId: session.strategyId ?? 'strategy-blueprint',
    sessionId: session.sessionId ?? 'backtest-session',
    symbol: session.symbol ?? 'MARKET',
    assetType: session.assetType ?? 'asset-agnostic',
    timeframe: session.timeframe ?? 'unknown',
    consumedCandles: numberValue(session.consumedCandles),
    generatedTrades: numberValue(executionSummary.generatedTrades),
    filledTrades: numberValue(executionSummary.filledTrades),
    rejectedTrades: numberValue(executionSummary.rejectedTrades),
    backtestExecutionStatus: backtestExecution.backtestExecutionStatus ?? 'unknown',
    paperTrading: true,
  }
}

function buildBacktestPerformanceSummary(backtestPerformance = {}) {
  const metrics = backtestPerformance.metrics ?? {}
  const returnCurveSummary = backtestPerformance.returnCurveSummary ?? {}

  return {
    analyticsStatus: backtestPerformance.analyticsStatus ?? 'unknown',
    totalSimulatedTrades: numberValue(metrics.totalSimulatedTrades ?? backtestPerformance.totalSimulatedTrades),
    includedTrades: numberValue(metrics.totalIncludedTrades ?? backtestPerformance.includedTrades),
    excludedTrades: numberValue(backtestPerformance.excludedTrades),
    winRate: round(metrics.winRate),
    netRealizedPnl: round(metrics.netRealizedPnl),
    averageWin: round(metrics.averageWin),
    averageLoss: round(metrics.averageLoss),
    profitFactor: round(metrics.profitFactor),
    expectancy: round(metrics.expectancy),
    maxDrawdown: round(metrics.maxDrawdown, 4),
    totalReturnPct: round(returnCurveSummary.totalReturnPct, 4),
    returnCurve: {
      startingEquity: round(returnCurveSummary.startingEquity),
      endingEquity: round(returnCurveSummary.endingEquity),
      pointCount: returnCurveSummary.points?.length ?? 0,
    },
    summary: backtestPerformance.summary ?? 'Backtest performance summary unavailable.',
  }
}

function buildWalkForwardRobustnessSummary(walkForward = {}) {
  return {
    status: walkForward.finalWalkForwardStatus ?? 'unknown',
    robustnessScore: round(walkForward.robustnessScore),
    windowCount: walkForward.rollingWindows?.length ?? walkForward.windowResults?.length ?? 0,
    degradationDetected: Boolean(walkForward.degradationDetection?.degraded),
    degradationPct: round(walkForward.degradationDetection?.degradationPct),
    degradationNotes: walkForward.degradationDetection?.notes ?? [],
    summary: walkForward.summary ?? 'Walk-forward robustness summary unavailable.',
  }
}

function buildMonteCarloRiskSummary(monteCarlo = {}) {
  const confidenceIntervalSummary = monteCarlo.confidenceIntervalSummary ?? {}

  return {
    robustnessClassification: monteCarlo.robustnessClassification ?? 'unknown',
    simulationCount: numberValue(monteCarlo.simulationCount),
    sourceTradeCount: numberValue(monteCarlo.tradeOutcomeSampling?.sourceTradeCount),
    probabilityOfDrawdownBreach: round(monteCarlo.probabilityOfDrawdownBreach),
    probabilityOfProfitability: round(monteCarlo.probabilityOfProfitability),
    drawdownThreshold: round(monteCarlo.drawdownThreshold),
    confidenceIntervalSummary: {
      finalEquityP05: round(confidenceIntervalSummary.finalEquityP05),
      finalEquityP50: round(confidenceIntervalSummary.finalEquityP50),
      finalEquityP95: round(confidenceIntervalSummary.finalEquityP95),
      pnlP05: round(confidenceIntervalSummary.pnlP05),
      pnlP50: round(confidenceIntervalSummary.pnlP50),
      pnlP95: round(confidenceIntervalSummary.pnlP95),
    },
    worstCasePathSummary: monteCarlo.worstCasePathSummary ?? null,
    medianPathSummary: monteCarlo.medianPathSummary ?? null,
    summary: monteCarlo.summary ?? 'Monte Carlo risk summary unavailable.',
  }
}

function buildKeyStrengths({ performanceSummary, walkForwardSummary, monteCarloSummary }) {
  const strengths = []

  if (performanceSummary.netRealizedPnl > 0) strengths.push('Backtest generated positive net realized paper P&L')
  if (performanceSummary.profitFactor >= 1.5) strengths.push('Profit factor indicates favorable payoff distribution')
  if (performanceSummary.winRate >= 50) strengths.push('Win rate is above neutral threshold')
  if (performanceSummary.expectancy > 0) strengths.push('Expectancy is positive across included simulated trades')
  if (walkForwardSummary.status === 'robust') strengths.push('Walk-forward robustness is classified as robust')
  if (!walkForwardSummary.degradationDetected && walkForwardSummary.windowCount > 0) strengths.push('No walk-forward degradation detected')
  if (monteCarloSummary.robustnessClassification === 'robust') strengths.push('Monte Carlo stress test is classified as robust')
  if (monteCarloSummary.probabilityOfProfitability >= 60) strengths.push('Monte Carlo profitability probability is favorable')
  if (monteCarloSummary.probabilityOfDrawdownBreach <= 20) strengths.push('Monte Carlo drawdown breach probability is controlled')

  return strengths.length > 0 ? strengths : ['No material strengths detected from completed paper-only research outputs']
}

function buildKeyWeaknesses({ strategySummary, performanceSummary, walkForwardSummary, monteCarloSummary }) {
  const weaknesses = []

  if (strategySummary.backtestExecutionStatus === 'blocked') weaknesses.push('Backtest execution is blocked')
  if (performanceSummary.analyticsStatus === 'blocked') weaknesses.push('Backtest performance analytics are blocked')
  if (performanceSummary.includedTrades === 0) weaknesses.push('No filled simulated paper trades were available for analysis')
  if (performanceSummary.netRealizedPnl <= 0) weaknesses.push('Backtest did not produce positive net realized paper P&L')
  if (performanceSummary.profitFactor > 0 && performanceSummary.profitFactor < 1) weaknesses.push('Profit factor is below one')
  if (walkForwardSummary.status === 'failed') weaknesses.push('Walk-forward robustness failed')
  if (walkForwardSummary.status === 'caution') weaknesses.push('Walk-forward robustness requires review')
  if (walkForwardSummary.degradationDetected) weaknesses.push('Walk-forward degradation was detected')
  if (monteCarloSummary.robustnessClassification === 'fragile') weaknesses.push('Monte Carlo simulation classified the strategy as fragile')
  if (monteCarloSummary.robustnessClassification === 'caution') weaknesses.push('Monte Carlo simulation requires review')
  if (monteCarloSummary.probabilityOfDrawdownBreach > 25) weaknesses.push('Monte Carlo drawdown breach probability is elevated')
  if ((monteCarloSummary.worstCasePathSummary?.totalPnl ?? 0) < 0) weaknesses.push('Worst-case Monte Carlo path is negative')

  return weaknesses.length > 0 ? weaknesses : ['No material weaknesses detected from completed paper-only research outputs']
}

function resolveRecommendation({ strategySummary, performanceSummary, walkForwardSummary, monteCarloSummary }) {
  if (
    strategySummary.backtestExecutionStatus === 'blocked'
    || performanceSummary.analyticsStatus === 'blocked'
    || performanceSummary.includedTrades === 0
    || walkForwardSummary.status === 'failed'
    || monteCarloSummary.robustnessClassification === 'fragile'
  ) {
    return 'reject'
  }

  if (
    performanceSummary.analyticsStatus === 'evaluated'
    && strategySummary.backtestExecutionStatus === 'completed'
    && performanceSummary.netRealizedPnl > 0
    && performanceSummary.profitFactor >= 1
    && walkForwardSummary.status === 'robust'
    && monteCarloSummary.robustnessClassification === 'robust'
    && monteCarloSummary.probabilityOfProfitability >= 60
  ) {
    return 'approve'
  }

  return 'revise'
}

export function generateBacktestReport(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const backtestExecution = getBacktestExecution(input)
  const backtestPerformance = getBacktestPerformance(input)
  const walkForward = getWalkForward(input)
  const monteCarlo = getMonteCarlo(input)
  const strategySummary = buildStrategySummary(backtestExecution)
  const backtestPerformanceSummary = buildBacktestPerformanceSummary(backtestPerformance)
  const walkForwardRobustnessSummary = buildWalkForwardRobustnessSummary(walkForward)
  const monteCarloRiskSummary = buildMonteCarloRiskSummary(monteCarlo)
  const recommendationContext = {
    strategySummary,
    performanceSummary: backtestPerformanceSummary,
    walkForwardSummary: walkForwardRobustnessSummary,
    monteCarloSummary: monteCarloRiskSummary,
  }
  const releaseResearchRecommendation = resolveRecommendation(recommendationContext)
  const result = {
    eventType: STRATEGY_BACKTEST_REPORT_GENERATED_EVENT,
    paperTrading: true,
    timestamp,
    strategySummary,
    backtestPerformanceSummary,
    walkForwardRobustnessSummary,
    monteCarloRiskSummary,
    keyStrengths: buildKeyStrengths(recommendationContext),
    keyWeaknesses: buildKeyWeaknesses(recommendationContext),
    releaseResearchRecommendation,
    normalizedStrategyResearchReport: {
      strategySummary,
      backtestPerformanceSummary,
      walkForwardRobustnessSummary,
      monteCarloRiskSummary,
      releaseResearchRecommendation,
      paperTrading: true,
      liveOrders: false,
      brokerageIntegration: false,
    },
    summary: `Backtest report ${releaseResearchRecommendation}: ${strategySummary.strategyId} paper research report generated from backtest, walk-forward, and Monte Carlo outputs.`,
    sourceEvents: {
      strategyBacktestExecution: backtestExecution.eventType ?? null,
      strategyBacktestPerformance: backtestPerformance.eventType ?? null,
      strategyWalkForward: walkForward.eventType ?? null,
      strategyMonteCarlo: monteCarlo.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_BACKTEST_REPORT_GENERATED_EVENT, result)
  }

  return result
}

export function createStrategyBacktestReportGenerator(options = {}) {
  return {
    generate(input, generationOptions = {}) {
      return generateBacktestReport(input, { ...options, ...generationOptions })
    },
  }
}
