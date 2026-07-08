import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_HEALTH_COMMAND_CENTER_EVALUATED_EVENT = 'system.healthCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeHealthStatus(status) {
  if (status === true || ['ready', 'stable', 'healthy', 'approved', 'filled', 'recorded', 'evaluated', 'updated', 'recommended', 'completed', 'clear', 'controlled', 'operational', 'valid', 'active', 'balanced', 'strong', 'robust', 'approve', 'bullish', 'supportive', 'risk-on', 'eligible', 'composed', 'prepared', 'low'].includes(status)) return 'operational'
  if (status === false || ['blocked', 'failed', 'critical', 'rejected', 'error', 'degraded', 'locked', 'fragile', 'invalid', 'reject'].includes(status)) return 'degraded'
  return 'caution'
}

function makeModule({ id, name, family, status, eventType, required = true, detail = null }) {
  const healthStatus = normalizeHealthStatus(status)
  return {
    id,
    name,
    family,
    sourceStatus: status ?? 'unknown',
    healthStatus,
    eventType: eventType ?? null,
    required,
    detail,
  }
}

function summarizeModules(name, modules = []) {
  const requiredModules = modules.filter((module) => module.required)
  const degraded = requiredModules.filter((module) => module.healthStatus === 'degraded')
  const caution = requiredModules.filter((module) => module.healthStatus === 'caution')
  const status = degraded.length > 0 ? 'degraded' : caution.length > 0 ? 'caution' : 'operational'

  return {
    name,
    status,
    moduleCount: modules.length,
    operationalCount: modules.filter((module) => module.healthStatus === 'operational').length,
    cautionCount: modules.filter((module) => module.healthStatus === 'caution').length,
    degradedCount: modules.filter((module) => module.healthStatus === 'degraded').length,
    modules,
  }
}

function buildTradingLifecycleHealthSummary(input = {}) {
  return summarizeModules('trading lifecycle', [
    makeModule({ id: 'portfolio-risk', name: 'Portfolio Risk Engine', family: 'trading', status: input.portfolioRisk?.summary?.riskLevel, eventType: input.portfolioRisk?.eventType }),
    makeModule({ id: 'trade-guardrail', name: 'Trade Guardrail Engine', family: 'trading', status: input.tradeGuardrail?.decision, eventType: input.tradeGuardrail?.eventType }),
    makeModule({ id: 'execution-simulation', name: 'Execution Simulation Engine', family: 'trading', status: input.executionSimulation?.finalStatus, eventType: input.executionSimulation?.eventType }),
    makeModule({ id: 'paper-accounting', name: 'Paper Accounting Engine', family: 'trading', status: input.accounting?.status, eventType: input.accounting?.eventType }),
    makeModule({ id: 'paper-journal', name: 'Paper Trade Journal Engine', family: 'trading', status: input.journal?.journalStatus, eventType: input.journal?.eventType }),
    makeModule({ id: 'ai-decision', name: 'AI Decision Orchestrator', family: 'trading', status: input.aiDecision?.finalDecision, eventType: input.aiDecision?.eventType }),
  ])
}

function buildResearchStackHealthSummary(input = {}) {
  return summarizeModules('research stack', [
    makeModule({ id: 'market-intelligence', name: 'Research Intelligence Engine', family: 'research', status: input.marketIntelligence?.riskSentimentSummary?.label ?? input.marketIntelligence?.status ?? 'evaluated', eventType: input.marketIntelligence?.eventType }),
    makeModule({ id: 'research-score', name: 'Research Signal Scoring Engine', family: 'research', status: input.researchSignalScore?.decisionBias, eventType: input.researchSignalScore?.eventType }),
    makeModule({ id: 'research-context', name: 'Research Decision Context Engine', family: 'research', status: input.researchDecisionContext?.decisionBiasSummary?.recommendedUse ?? 'prepared', eventType: input.researchDecisionContext?.eventType }),
    makeModule({ id: 'multi-timeframe-research', name: 'Multi-Timeframe Research Engine', family: 'research', status: input.multiTimeframeResearch?.dominantTimeframeBias?.bias, eventType: input.multiTimeframeResearch?.eventType }),
    makeModule({ id: 'market-regime', name: 'Market Regime Classification Engine', family: 'research', status: input.marketRegime?.riskRegime?.regime, eventType: input.marketRegime?.eventType }),
    makeModule({ id: 'research-enhanced-decision', name: 'Research-Enhanced AI Decision Integration', family: 'research', status: input.researchEnhancedDecision?.finalResearchAwareDecisionSummary?.finalDecision, eventType: input.researchEnhancedDecision?.eventType }),
  ])
}

function buildStrategyStackHealthSummary(input = {}) {
  return summarizeModules('strategy stack', [
    makeModule({ id: 'strategy-builder', name: 'Strategy Builder Engine', family: 'strategy', status: input.strategyBlueprint?.validationStatus, eventType: input.strategyBlueprint?.eventType }),
    makeModule({ id: 'strategy-rules', name: 'Strategy Rule Evaluation Engine', family: 'strategy', status: input.strategyRuleEvaluation?.strategyEvaluationStatus, eventType: input.strategyRuleEvaluation?.eventType }),
    makeModule({ id: 'strategy-signal', name: 'Strategy Signal Composer', family: 'strategy', status: input.strategySignal?.signalStatus, eventType: input.strategySignal?.eventType }),
    makeModule({ id: 'strategy-lifecycle', name: 'Strategy Lifecycle Manager', family: 'strategy', status: input.strategyLifecycle?.lifecycleState, eventType: input.strategyLifecycle?.eventType }),
    makeModule({ id: 'strategy-registry', name: 'Strategy Registry Engine', family: 'strategy', status: input.strategyRegistry?.status ?? 'updated', eventType: input.strategyRegistry?.eventType }),
    makeModule({ id: 'multi-strategy', name: 'Multi-Strategy Portfolio Manager', family: 'strategy', status: input.strategyPortfolioManager?.strategyApprovalStatus, eventType: input.strategyPortfolioManager?.eventType }),
  ])
}

function buildBacktestingStackHealthSummary(input = {}) {
  return summarizeModules('backtesting stack', [
    makeModule({ id: 'backtest-input', name: 'Strategy Backtest Input Builder', family: 'backtesting', status: input.strategyBacktestInput?.readinessStatus, eventType: input.strategyBacktestInput?.eventType }),
    makeModule({ id: 'historical-replay', name: 'Historical Replay Engine', family: 'backtesting', status: input.historicalReplay?.replayStepOutput?.status, eventType: input.historicalReplay?.eventType }),
    makeModule({ id: 'backtest-execution', name: 'Backtest Execution Engine', family: 'backtesting', status: input.strategyBacktestExecution?.backtestExecutionStatus, eventType: input.strategyBacktestExecution?.eventType }),
    makeModule({ id: 'backtest-performance', name: 'Backtest Performance Analytics Engine', family: 'backtesting', status: input.strategyBacktestPerformance?.analyticsStatus, eventType: input.strategyBacktestPerformance?.eventType }),
    makeModule({ id: 'walk-forward', name: 'Walk-Forward Testing Engine', family: 'backtesting', status: input.strategyWalkForward?.finalWalkForwardStatus, eventType: input.strategyWalkForward?.eventType }),
    makeModule({ id: 'monte-carlo', name: 'Monte Carlo Simulation Engine', family: 'backtesting', status: input.strategyMonteCarlo?.robustnessClassification, eventType: input.strategyMonteCarlo?.eventType }),
    makeModule({ id: 'backtest-report', name: 'Backtest Report Generator', family: 'backtesting', status: input.strategyBacktestReport?.releaseResearchRecommendation, eventType: input.strategyBacktestReport?.eventType }),
  ])
}

function buildPortfolioAnalyticsHealthSummary(input = {}) {
  return summarizeModules('portfolio analytics', [
    makeModule({ id: 'portfolio-analytics', name: 'Portfolio Analytics Engine', family: 'portfolio', status: input.portfolioAnalytics?.status ?? input.portfolioAnalytics?.diversification?.label, eventType: input.portfolioAnalytics?.eventType }),
    makeModule({ id: 'portfolio-correlation', name: 'Portfolio Correlation Engine', family: 'portfolio', status: input.portfolioCorrelation?.correlationRiskStatus, eventType: input.portfolioCorrelation?.eventType }),
    makeModule({ id: 'factor-exposure', name: 'Factor Exposure Engine', family: 'portfolio', status: input.portfolioFactorExposure?.factorRiskStatus, eventType: input.portfolioFactorExposure?.eventType }),
    makeModule({ id: 'optimization', name: 'Portfolio Optimization Recommendation Engine', family: 'portfolio', status: input.portfolioOptimization?.recommendationPriority, eventType: input.portfolioOptimization?.eventType }),
    makeModule({ id: 'optimization-governance', name: 'Portfolio Optimization Governance Engine', family: 'portfolio', status: input.portfolioOptimizationGovernance?.governanceStatus, eventType: input.portfolioOptimizationGovernance?.eventType }),
    makeModule({ id: 'rebalance', name: 'Portfolio Rebalancing Recommendation Engine', family: 'portfolio', status: input.rebalancing?.status ?? 'recommended', eventType: input.rebalancing?.eventType }),
    makeModule({ id: 'strategy-attribution', name: 'Strategy Attribution Engine', family: 'portfolio', status: input.strategyAttribution?.status, eventType: input.strategyAttribution?.eventType }),
  ])
}

function buildAdapterMockModeHealthSummary(input = {}) {
  const market = input.marketDataAdapterHealth ?? {}
  const broker = input.brokerAdapterHealth ?? {}
  return summarizeModules('adapter mock mode', [
    makeModule({
      id: 'market-data-adapter',
      name: 'Market Data Adapter',
      family: 'adapter',
      status: market.health?.status,
      eventType: market.eventType,
      detail: { provider: market.health?.provider ?? market.metadata?.id, paperTrading: market.health?.paperTrading ?? market.metadata?.paperTrading },
    }),
    makeModule({
      id: 'broker-adapter',
      name: 'Broker Adapter',
      family: 'adapter',
      status: broker.health?.liveOrders === true || broker.health?.paperTrading === false ? 'blocked' : broker.health?.status,
      eventType: broker.eventType,
      detail: { provider: broker.health?.provider ?? broker.metadata?.id, paperTrading: broker.health?.paperTrading ?? broker.metadata?.paperTrading, liveOrders: broker.health?.liveOrders ?? broker.metadata?.liveOrders },
    }),
    makeModule({ id: 'release-readiness', name: 'Release Readiness', family: 'system', status: input.releaseReadiness?.releaseReadinessStatus, eventType: input.releaseReadiness?.eventType }),
    makeModule({ id: 'release-stabilization', name: 'Release Candidate Stabilization', family: 'system', status: input.releaseCandidateStabilization?.finalStatus, eventType: input.releaseCandidateStabilization?.eventType }),
  ])
}

function buildEventObservabilityHealthSummary(input = {}) {
  return summarizeModules('event observability', [
    makeModule({ id: 'event-observability', name: 'Enterprise Event Observability Engine', family: 'system', status: input.eventObservability?.observabilityStatus, eventType: input.eventObservability?.eventType }),
  ])
}

function buildModuleHealthRegistry(summaries = []) {
  return summaries.flatMap((summary) => summary.modules)
}

function resolvePlatformHealthStatus(summaries = []) {
  if (summaries.some((summary) => summary.status === 'degraded')) return 'degraded'
  if (summaries.some((summary) => summary.status === 'caution')) return 'caution'
  return 'operational'
}

export function evaluateSystemHealthCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tradingLifecycleHealthSummary = buildTradingLifecycleHealthSummary(input)
  const researchStackHealthSummary = buildResearchStackHealthSummary(input)
  const strategyStackHealthSummary = buildStrategyStackHealthSummary(input)
  const backtestingStackHealthSummary = buildBacktestingStackHealthSummary(input)
  const portfolioAnalyticsHealthSummary = buildPortfolioAnalyticsHealthSummary(input)
  const adapterMockModeHealthSummary = buildAdapterMockModeHealthSummary(input)
  const eventObservabilityHealthSummary = buildEventObservabilityHealthSummary(input)
  const stackSummaries = [
    tradingLifecycleHealthSummary,
    researchStackHealthSummary,
    strategyStackHealthSummary,
    backtestingStackHealthSummary,
    portfolioAnalyticsHealthSummary,
    adapterMockModeHealthSummary,
    eventObservabilityHealthSummary,
  ]
  const moduleHealthRegistry = buildModuleHealthRegistry(stackSummaries)
  const finalPlatformHealthStatus = resolvePlatformHealthStatus(stackSummaries)
  const result = {
    eventType: SYSTEM_HEALTH_COMMAND_CENTER_EVALUATED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    timestamp,
    moduleHealthRegistry,
    tradingLifecycleHealthSummary,
    researchStackHealthSummary,
    strategyStackHealthSummary,
    backtestingStackHealthSummary,
    portfolioAnalyticsHealthSummary,
    adapterMockModeHealthSummary,
    eventObservabilityHealthSummary,
    finalPlatformHealthStatus,
    summary: `System health command center ${finalPlatformHealthStatus}: ${moduleHealthRegistry.length} modules reviewed across ${stackSummaries.length} stacks.`,
    sourceEvents: {
      releaseReadiness: input.releaseReadiness?.eventType ?? null,
      releaseCandidateStabilization: input.releaseCandidateStabilization?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_HEALTH_COMMAND_CENTER_EVALUATED_EVENT, result)
  }

  return result
}

export function createSystemHealthCommandCenterEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateSystemHealthCommandCenter(input, { ...options, ...evaluationOptions })
    },
  }
}
