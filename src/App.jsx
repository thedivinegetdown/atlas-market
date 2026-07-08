import { Suspense, useMemo } from 'react'
import './App.css'
import { applyPaperPortfolioAccounting } from './core/accounting/paperPortfolioAccountingEngine.js'
import { orchestrateAIDecision } from './core/ai/aiDecisionOrchestrator.js'
import { integrateResearchEnhancedDecision } from './core/ai/researchEnhancedDecisionIntegration.js'
import { recommendCapitalAllocation } from './core/analytics/capitalAllocationEngine.js'
import { evaluatePaperPerformance } from './core/analytics/paperPerformanceAnalyticsEngine.js'
import { evaluatePortfolioAnalytics } from './core/analytics/portfolioAnalyticsEngine.js'
import { evaluatePortfolioCorrelation } from './core/analytics/portfolioCorrelationEngine.js'
import { evaluatePortfolioFactorExposure } from './core/analytics/portfolioFactorExposureEngine.js'
import { reviewPortfolioOptimizationGovernance } from './core/analytics/portfolioOptimizationGovernanceEngine.js'
import { recommendPortfolioOptimization } from './core/analytics/portfolioOptimizationRecommendationEngine.js'
import { recommendPortfolioRebalance } from './core/analytics/portfolioRebalanceRecommendationEngine.js'
import { evaluateRiskAdjustedPerformance } from './core/analytics/riskAdjustedPerformanceEngine.js'
import { evaluateStrategyAttribution } from './core/analytics/strategyAttributionEngine.js'
import { simulateTradeExecution } from './core/execution/executionSimulationEngine.js'
import { recordPaperTradeJournal } from './core/journal/paperTradeJournalEngine.js'
import { evaluateDrawdownProtection } from './core/risk/drawdownProtectionEngine.js'
import { evaluatePortfolioRisk } from './core/risk/portfolioRiskEngine.js'
import { recommendPositionSize } from './core/risk/positionSizingEngine.js'
import { evaluateTradeGuardrail } from './core/risk/tradeGuardrailEngine.js'
import { evaluateMultiStrategyPortfolioManager } from './core/strategy/multiStrategyPortfolioManager.js'
import { validateStrategyBlueprint } from './core/strategy/strategyBuilderEngine.js'
import { evaluateStrategyRules } from './core/strategy/strategyRuleEvaluationEngine.js'
import { composeStrategySignal } from './core/strategy/strategySignalComposer.js'
import { updateStrategyLifecycle } from './core/strategy/strategyLifecycleManager.js'
import { updateStrategyRegistry } from './core/strategy/strategyRegistryEngine.js'
import { prepareStrategyBacktestInput } from './core/strategy/strategyBacktestInputBuilder.js'
import { executeStrategyBacktest } from './core/strategy/strategyBacktestExecutionEngine.js'
import { evaluateBacktestPerformance } from './core/strategy/strategyBacktestPerformanceAnalyticsEngine.js'
import { evaluateWalkForwardTesting } from './core/strategy/strategyWalkForwardTestingEngine.js'
import { simulateMonteCarloStrategy } from './core/strategy/strategyMonteCarloSimulationEngine.js'
import { generateBacktestReport } from './core/strategy/strategyBacktestReportGenerator.js'
import {
  BROKER_ADAPTER_CHECKED_EVENT,
  createBrokerAdapter,
  normalizeBrokerAccount,
  normalizeBrokerPosition,
} from '../lib/brokers/brokerAdapter.js'
import { classifyMarketRegime } from '../lib/market/marketRegimeClassificationEngine.js'
import { prepareHistoricalReplayStep } from '../lib/market/historicalMarketReplayEngine.js'
import { createMarketDataAdapter, MARKET_DATA_ADAPTER_CHECKED_EVENT } from '../lib/market/marketDataAdapter.js'
import { evaluateMultiTimeframeResearchContext } from '../lib/research/multiTimeframeResearchContextEngine.js'
import { prepareResearchDecisionContext } from '../lib/research/researchDecisionContextEngine.js'
import { evaluateMarketIntelligence } from '../lib/research/marketIntelligenceEngine.js'
import { evaluateResearchSignalScore } from '../lib/research/researchSignalScoringEngine.js'
import { createSignalEngine } from '../lib/signals/signalEngine.js'
import { observeSystemEvents } from '../lib/system/eventObservabilityEngine.js'
import { evaluateReleaseCandidateStabilization } from '../lib/system/releaseCandidateStabilization.js'
import { evaluateReleaseReadiness } from '../lib/system/releaseReadiness.js'
import { evaluateSystemHealthCommandCenter } from '../lib/system/systemHealthCommandCenterEngine.js'
import { generateOperatorActions } from '../lib/system/operatorActionCenterEngine.js'
import { recordEnterpriseAuditTrail } from '../lib/system/enterpriseAuditTrailEngine.js'
import { evaluateEnterpriseReleaseControl } from '../lib/system/enterpriseReleaseControlCenterEngine.js'
import { prepareWorkspacePersistence } from '../lib/system/workspacePersistenceEngine.js'
import {
  accountingDemoPortfolio,
  demoExecutionQuotes,
  demoPortfolio,
  demoProposedTrades,
  guardrailDemoPortfolio,
} from './data/demoPortfolio.js'

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0))
}

function formatPercent(value) {
  return `${Number(value ?? 0).toFixed(2)}%`
}

function formatDate(value) {
  return new Date(value).toLocaleString()
}

const demoCorrelationPriceSeries = Object.freeze({
  SPY: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 582.1 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 585.7 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 589.2 }),
    Object.freeze({ timestamp: '2025-01-06T00:00:00.000Z', close: 591.6 }),
  ]),
  AAPL: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 186.2 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 188.4 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 190.1 }),
    Object.freeze({ timestamp: '2025-01-06T00:00:00.000Z', close: 192.44 }),
  ]),
  'BTC-USD': Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 62800 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 64250 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 66100 }),
    Object.freeze({ timestamp: '2025-01-06T00:00:00.000Z', close: 67150 }),
  ]),
  EURUSD: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 1.0825 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 1.0851 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 1.0882 }),
    Object.freeze({ timestamp: '2025-01-06T00:00:00.000Z', close: 1.0912 }),
  ]),
  ES: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 5480 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 5472 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 5468 }),
    Object.freeze({ timestamp: '2025-01-06T00:00:00.000Z', close: 5462.5 }),
  ]),
})

function getRiskTone(level) {
  if (level === 'critical' || level === 'high') return 'danger'
  if (level === 'elevated') return 'warning'
  return 'positive'
}

function MetricCard({ label, value, tone }) {
  return (
    <article className={`metric-card ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function PanelLoadingFallback({ label = 'Loading dashboard panel' }) {
  return (
    <article className="panel">
      <div className="panel-heading">
        <h2>{label}</h2>
        <span>Preparing paper-trading dashboard context.</span>
      </div>
    </article>
  )
}

function ExposureBar({ label, value, tone }) {
  const width = Math.min(100, Math.abs(Number(value ?? 0)))

  return (
    <div className="exposure-row">
      <div>
        <span>{label}</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div className="exposure-track" aria-hidden="true">
        <span className={tone ?? ''} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function buildDemoTimeframeContext(baseContext, bucket, overrides = {}) {
  return {
    bucket,
    researchDecisionContext: {
      ...baseContext,
      researchScoreSummary: {
        ...baseContext.researchScoreSummary,
        finalResearchScore: overrides.finalResearchScore ?? baseContext.researchScoreSummary.finalResearchScore,
        trendAlignmentScore: overrides.trendAlignmentScore ?? baseContext.researchScoreSummary.trendAlignmentScore,
      },
      decisionBiasSummary: {
        ...baseContext.decisionBiasSummary,
        decisionBias: overrides.decisionBias ?? baseContext.decisionBiasSummary.decisionBias,
      },
      marketContextSummary: {
        ...baseContext.marketContextSummary,
        trend: {
          ...baseContext.marketContextSummary.trend,
          direction: overrides.trendDirection ?? baseContext.marketContextSummary.trend.direction,
          alignmentScore: overrides.trendAlignmentScore ?? baseContext.marketContextSummary.trend.alignmentScore,
          score: overrides.trendAlignmentScore ?? baseContext.marketContextSummary.trend.score,
        },
        volatility: {
          ...baseContext.marketContextSummary.volatility,
          label: overrides.volatilityLabel ?? baseContext.marketContextSummary.volatility.label,
          score: overrides.volatilityScore ?? baseContext.marketContextSummary.volatility.score,
          adjustment: overrides.volatilityAdjustment ?? baseContext.marketContextSummary.volatility.adjustment,
        },
      },
    },
  }
}

function WorkspaceLayout({ navigation, children }) {
  return (
    <section className="workspace-layout" aria-label="Institutional trading workspace">
      <aside className="workspace-rail" aria-label="Workspace operating panels">
        <div>
          <span className="workspace-rail-kicker">Workspace</span>
          <strong>Paper Trading OS</strong>
        </div>
        <nav>
          {navigation.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="workspace-rail-item">
              <span>{item.label}</span>
              <strong>{item.status}</strong>
            </a>
          ))}
        </nav>
      </aside>
      <section className="dashboard-grid workspace-panels">
        {children}
      </section>
    </section>
  )
}

function App() {
  const risk = useMemo(() => evaluatePortfolioRisk(demoPortfolio, { emitEvent: false }), [])
  const portfolioAnalytics = useMemo(() => evaluatePortfolioAnalytics(demoPortfolio, {
    emitEvent: false,
    riskSnapshot: risk,
  }), [risk])
  const guardrails = useMemo(() => demoProposedTrades.map((trade) => ({
    label: trade.label,
    tradeId: trade.id,
    result: evaluateTradeGuardrail(
      trade.id === 'paper-trade-approved' ? guardrailDemoPortfolio : demoPortfolio,
      trade,
      { emitEvent: false },
    ),
  })), [])
  const executions = useMemo(() => guardrails.map((guardrail) => ({
    label: guardrail.label,
    result: simulateTradeExecution(
      guardrail.result,
      demoExecutionQuotes[guardrail.tradeId],
      { emitEvent: false },
    ),
  })), [guardrails])
  const accountingUpdates = useMemo(() => executions.map((execution) => ({
    label: execution.label,
    result: applyPaperPortfolioAccounting(accountingDemoPortfolio, execution.result, { emitEvent: false }),
  })), [executions])
  const primaryAccounting = accountingUpdates[0]?.result
  const journalRecords = useMemo(() => guardrails.map((guardrail, index) => ({
    label: guardrail.label,
    result: recordPaperTradeJournal({
      proposedTrade: demoProposedTrades.find((trade) => trade.id === guardrail.tradeId),
      guardrailDecision: guardrail.result,
      executionSimulation: executions[index]?.result,
      accountingUpdate: accountingUpdates[index]?.result,
    }, { emitEvent: false }),
  })), [accountingUpdates, executions, guardrails])
  const performance = useMemo(() => evaluatePaperPerformance(
    journalRecords.map((record) => record.result),
    { emitEvent: false },
  ), [journalRecords])
  const riskAdjustedPerformance = useMemo(() => evaluateRiskAdjustedPerformance(
    journalRecords.map((record) => record.result),
    {
      emitEvent: false,
      performanceSnapshot: performance,
      startingEquity: accountingDemoPortfolio.accountValue,
    },
  ), [journalRecords, performance])
  const drawdownProtection = useMemo(() => evaluateDrawdownProtection(
    primaryAccounting ?? accountingDemoPortfolio,
    journalRecords.map((record) => record.result),
    {
      emitEvent: false,
      riskAdjustedPerformance,
      equityPeak: accountingDemoPortfolio.accountValue,
    },
  ), [journalRecords, primaryAccounting, riskAdjustedPerformance])
  const positionSizing = useMemo(() => recommendPositionSize(
    guardrailDemoPortfolio,
    demoProposedTrades[0],
    {
      emitEvent: false,
      portfolioRisk: evaluatePortfolioRisk(guardrailDemoPortfolio, { emitEvent: false }),
      drawdownProtection,
      guardrailDecision: guardrails[0]?.result,
      limits: {
        equityRiskPct: 0.75,
        maxRiskPerTradePct: 1,
        maxPositionValuePct: 8,
      },
    },
  ), [drawdownProtection, guardrails])
  const strategyAttribution = useMemo(() => evaluateStrategyAttribution(
    journalRecords.map((record) => record.result),
    { emitEvent: false },
  ), [journalRecords])
  const capitalAllocation = useMemo(() => recommendCapitalAllocation(demoPortfolio, {
    emitEvent: false,
    portfolioAnalytics,
    riskSnapshot: risk,
    performanceSnapshot: performance,
    drawdownProtection,
    positionSizing,
    strategyAttribution,
  }), [drawdownProtection, performance, portfolioAnalytics, positionSizing, risk, strategyAttribution])
  const aiDecisionInput = useMemo(() => ({
    proposedTrade: demoProposedTrades[0],
    scannerSignals: [
      {
        symbol: 'SPY',
        direction: 'bullish',
        score: 74,
        confidence: 70,
        source: 'scanner-foundation',
      },
    ],
    portfolioRisk: risk,
    drawdownProtection,
    positionSizing,
    capitalAllocation,
    guardrailDecision: guardrails[0]?.result,
    performanceSnapshot: performance,
    riskAdjustedPerformance,
  }), [capitalAllocation, drawdownProtection, guardrails, performance, positionSizing, risk, riskAdjustedPerformance])
  const aiDecision = useMemo(() => orchestrateAIDecision(aiDecisionInput, { emitEvent: false }), [aiDecisionInput])
  const strategyPortfolioManager = useMemo(() => evaluateMultiStrategyPortfolioManager({
    activeStrategies: [
      {
        id: 'index-pullback',
        name: 'Index Pullback',
        priority: 1,
        enabled: true,
        maxExposurePct: 12,
        riskBudgetPct: 1,
      },
      {
        id: 'volatility-breakout',
        name: 'Volatility Breakout',
        priority: 2,
        enabled: true,
        maxExposurePct: 8,
        riskBudgetPct: 0.75,
      },
    ],
    proposedTrades: demoProposedTrades,
    aiDecision,
    capitalAllocation,
    portfolioAnalytics,
    strategyAttribution,
    portfolioRisk: risk,
  }, { emitEvent: false }), [aiDecision, capitalAllocation, portfolioAnalytics, risk, strategyAttribution])
  const marketDataAdapterHealth = useMemo(() => {
    const adapter = createMarketDataAdapter()
    return {
      metadata: adapter.metadata,
      health: adapter.getProviderHealth(),
      eventType: MARKET_DATA_ADAPTER_CHECKED_EVENT,
    }
  }, [])
  const brokerAdapterHealth = useMemo(() => {
    const adapter = createBrokerAdapter()
    const account = normalizeBrokerAccount({
      id: primaryAccounting?.portfolioId ?? accountingDemoPortfolio.id,
      ...(primaryAccounting?.account ?? accountingDemoPortfolio),
    }, adapter.metadata.id)
    const positions = (primaryAccounting?.positions ?? accountingDemoPortfolio.positions)
      .map((position) => normalizeBrokerPosition(position, adapter.metadata.id))

    return {
      metadata: adapter.metadata,
      health: adapter.getProviderHealth(),
      account,
      positions,
      lastSimulatedOrder: adapter.normalizeOrderResponse(executions[0]?.result),
      eventType: BROKER_ADAPTER_CHECKED_EVENT,
    }
  }, [executions, primaryAccounting])
  const scannerSignal = useMemo(() => {
    const quote = {
      symbol: demoProposedTrades[0].symbol,
      assetType: demoProposedTrades[0].assetType,
      price: demoExecutionQuotes['paper-trade-approved'].last,
      open: 524.8,
      high: demoExecutionQuotes['paper-trade-approved'].high,
      low: demoExecutionQuotes['paper-trade-approved'].low,
      previousClose: 524.66,
      volume: 1240000,
      averageVolume: 990000,
      bid: demoExecutionQuotes['paper-trade-approved'].bid,
      ask: demoExecutionQuotes['paper-trade-approved'].ask,
      timestamp: demoExecutionQuotes['paper-trade-approved'].timestamp,
    }
    const signal = createSignalEngine().evaluateQuote(quote)

    return {
      quote,
      signal,
      matches: [
        {
          scanner: 'Momentum Pullback',
          symbol: quote.symbol,
          assetType: quote.assetType,
          criteria: ['price_above', 'signal_bullish', 'risk_acceptable'],
          evaluatedAt: quote.timestamp,
        },
      ],
    }
  }, [])
  const rebalancing = useMemo(() => recommendPortfolioRebalance(demoPortfolio, {
    emitEvent: false,
    analyticsSnapshot: portfolioAnalytics,
    riskSnapshot: risk,
  }), [portfolioAnalytics, risk])
  const releaseReadiness = useMemo(() => evaluateReleaseReadiness({
    env: {
      NODE_ENV: 'production',
      TRADING_MODE: 'paper',
      DATABASE_URL: 'release-candidate-configured',
    },
    adapters: [
      {
        name: 'Market Data Adapter',
        provider: marketDataAdapterHealth.metadata.id,
        status: marketDataAdapterHealth.health.status,
        paperTrading: marketDataAdapterHealth.health.paperTrading,
        liveOrders: false,
      },
      {
        name: 'Broker Adapter',
        provider: brokerAdapterHealth.metadata.id,
        status: brokerAdapterHealth.health.status,
        paperTrading: brokerAdapterHealth.health.paperTrading,
        liveOrders: brokerAdapterHealth.health.liveOrders,
      },
    ],
    brokerHealth: brokerAdapterHealth.health,
    eventContracts: [
      { expected: MARKET_DATA_ADAPTER_CHECKED_EVENT, actual: marketDataAdapterHealth.eventType },
      { expected: BROKER_ADAPTER_CHECKED_EVENT, actual: brokerAdapterHealth.eventType },
      { expected: risk.eventType, actual: risk.eventType },
      { expected: guardrails[0]?.result.eventType, actual: guardrails[0]?.result.eventType },
      { expected: executions[0]?.result.eventType, actual: executions[0]?.result.eventType },
      { expected: primaryAccounting?.eventType, actual: primaryAccounting?.eventType },
      { expected: journalRecords[0]?.result.eventType, actual: journalRecords[0]?.result.eventType },
      { expected: aiDecision.eventType, actual: aiDecision.eventType },
    ],
    guardrails: guardrails.map((guardrail) => guardrail.result),
    executions: executions.map((execution) => execution.result),
    validation: {
      tests: {
        command: 'npm test',
        status: 'passed',
        summary: 'Release candidate validation target',
      },
      build: {
        command: 'npm run build',
        status: 'passed',
        summary: 'Production build validation target',
      },
    },
  }, { emitEvent: false }), [aiDecision, brokerAdapterHealth, executions, guardrails, journalRecords, marketDataAdapterHealth, primaryAccounting, risk])
  const riskTone = getRiskTone(risk.summary.riskLevel)
  const eventTimeline = useMemo(() => [
    {
      label: 'Market data adapter checked',
      eventType: marketDataAdapterHealth.eventType,
      status: marketDataAdapterHealth.health.status,
      timestamp: marketDataAdapterHealth.health.checkedAt,
    },
    {
      label: 'Broker adapter checked',
      eventType: brokerAdapterHealth.eventType,
      status: brokerAdapterHealth.health.status,
      timestamp: brokerAdapterHealth.health.checkedAt,
    },
    {
      label: 'Release readiness evaluated',
      eventType: releaseReadiness.eventType,
      status: releaseReadiness.releaseReadinessStatus,
      timestamp: releaseReadiness.timestamp,
    },
    {
      label: 'Portfolio risk evaluated',
      eventType: risk.eventType,
      status: risk.summary.riskLevel,
      timestamp: risk.timestamp,
    },
    {
      label: 'Trade guardrail evaluated',
      eventType: guardrails[0]?.result.eventType,
      status: guardrails[0]?.result.decision,
      timestamp: guardrails[0]?.result.timestamp,
    },
    {
      label: 'Execution simulation completed',
      eventType: executions[0]?.result.eventType,
      status: executions[0]?.result.finalStatus,
      timestamp: executions[0]?.result.timestamp,
    },
    {
      label: 'Portfolio accounting updated',
      eventType: primaryAccounting?.eventType,
      status: primaryAccounting?.status,
      timestamp: primaryAccounting?.timestamp,
    },
    {
      label: 'Journal record captured',
      eventType: journalRecords[0]?.result.eventType,
      status: journalRecords[0]?.result.journalStatus,
      timestamp: journalRecords[0]?.result.timestamp,
    },
    {
      label: 'AI decision orchestrated',
      eventType: aiDecision.eventType,
      status: aiDecision.finalDecision,
      timestamp: aiDecision.timestamp,
    },
    {
      label: 'Strategy manager evaluated',
      eventType: strategyPortfolioManager.eventType,
      status: strategyPortfolioManager.strategyApprovalStatus,
      timestamp: strategyPortfolioManager.timestamp,
    },
  ].filter((event) => event.eventType), [aiDecision, brokerAdapterHealth, executions, guardrails, journalRecords, marketDataAdapterHealth, primaryAccounting, releaseReadiness, risk, strategyPortfolioManager])
  const releaseCandidateStabilization = useMemo(() => evaluateReleaseCandidateStabilization({
    releaseReadiness,
    brokerHealth: brokerAdapterHealth.health,
    adapters: [
      {
        name: marketDataAdapterHealth.metadata.name,
        provider: marketDataAdapterHealth.metadata.id,
        default: marketDataAdapterHealth.metadata.default,
        paperTrading: marketDataAdapterHealth.metadata.paperTrading,
        liveOrders: false,
      },
      {
        name: brokerAdapterHealth.metadata.name,
        provider: brokerAdapterHealth.metadata.id,
        default: brokerAdapterHealth.metadata.default,
        paperTrading: brokerAdapterHealth.metadata.paperTrading,
        liveOrders: brokerAdapterHealth.metadata.liveOrders,
      },
    ],
    regressionChecklist: [
      { name: 'guardrail approval and rejection paths', status: guardrails.some((guardrail) => guardrail.result.decision === 'approved') && guardrails.some((guardrail) => guardrail.result.decision === 'rejected') ? 'passed' : 'failed' },
      { name: 'paper execution simulation', status: executions.some((execution) => execution.result.finalStatus === 'filled') ? 'passed' : 'failed' },
      { name: 'paper accounting update', status: primaryAccounting?.status !== 'rejected' ? 'passed' : 'failed' },
      { name: 'journal lifecycle capture', status: journalRecords.some((record) => record.result.journalStatus === 'recorded') ? 'passed' : 'failed' },
      { name: 'release readiness gate', status: releaseReadiness.releaseReadinessStatus === 'ready' ? 'passed' : 'failed' },
    ],
    criticalModules: [
      { name: 'market data adapter', status: marketDataAdapterHealth.health.status, eventType: marketDataAdapterHealth.eventType },
      { name: 'broker adapter', status: brokerAdapterHealth.health.status, eventType: brokerAdapterHealth.eventType },
      { name: 'portfolio risk', status: risk.summary.riskLevel === 'critical' ? 'caution' : 'healthy', eventType: risk.eventType },
      { name: 'trade guardrail', status: guardrails.length > 0 ? 'healthy' : 'failed', eventType: guardrails[0]?.result.eventType },
      { name: 'release readiness', status: releaseReadiness.releaseReadinessStatus, eventType: releaseReadiness.eventType },
    ],
    dashboardSmokeTests: [
      { name: 'market data health panel', panel: 'Market Data Health', status: 'passed' },
      { name: 'broker adapter health panel', panel: 'Broker Adapter Health', status: 'passed' },
      { name: 'release readiness panel', panel: 'Release Readiness', status: 'passed' },
      { name: 'event timeline panel', panel: 'Event Timeline', status: eventTimeline.length >= 8 ? 'passed' : 'failed' },
      { name: 'paper lifecycle panels', panel: 'Guardrail / Execution / Accounting / Journal', status: primaryAccounting ? 'passed' : 'failed' },
    ],
    eventPipeline: eventTimeline,
    guardrails: guardrails.map((guardrail) => guardrail.result),
    executions: executions.map((execution) => execution.result),
  }, { emitEvent: false }), [brokerAdapterHealth, eventTimeline, executions, guardrails, journalRecords, marketDataAdapterHealth, primaryAccounting, releaseReadiness, risk])
  const marketIntelligence = useMemo(() => evaluateMarketIntelligence({
    symbol: scannerSignal.quote.symbol,
    assetType: scannerSignal.quote.assetType,
    marketData: {
      ...scannerSignal.quote,
      changePercent: 0.9,
    },
    portfolioAnalytics,
    riskSnapshot: risk,
    aiDecision,
    releaseReadiness,
    marketDataAdapterHealth: {
      eventType: marketDataAdapterHealth.eventType,
      provider: marketDataAdapterHealth.health.provider,
    },
    catalysts: [
      {
        type: 'macro',
        title: 'Mock catalyst input: broad risk appetite remains constructive',
        sentiment: 'positive',
        confidence: 68,
        source: 'demo-research-input',
      },
      {
        type: 'event',
        title: 'Mock catalyst input: no live news provider connected',
        sentiment: 'neutral',
        confidence: 55,
        source: 'demo-research-input',
      },
    ],
  }, { emitEvent: false }), [aiDecision, marketDataAdapterHealth, portfolioAnalytics, releaseReadiness, risk, scannerSignal])
  const researchSignalScore = useMemo(() => evaluateResearchSignalScore({
    researchIntelligence: marketIntelligence,
    aiDecision,
  }, { emitEvent: false }), [aiDecision, marketIntelligence])
  const researchDecisionContext = useMemo(() => prepareResearchDecisionContext({
    researchIntelligence: marketIntelligence,
    researchSignalScore,
    aiDecision,
  }, { emitEvent: false }), [aiDecision, marketIntelligence, researchSignalScore])
  const multiTimeframeResearchContext = useMemo(() => evaluateMultiTimeframeResearchContext({
    symbol: researchDecisionContext.symbol,
    assetType: researchDecisionContext.assetType,
    timeframes: [
      buildDemoTimeframeContext(researchDecisionContext, 'intraday', {
        finalResearchScore: Math.max(0, researchDecisionContext.researchScoreSummary.finalResearchScore - 6),
        trendAlignmentScore: Math.max(0, researchDecisionContext.researchScoreSummary.trendAlignmentScore - 4),
        volatilityLabel: 'elevated',
        volatilityScore: 58,
        volatilityAdjustment: 0,
      }),
      buildDemoTimeframeContext(researchDecisionContext, 'swing'),
      buildDemoTimeframeContext(researchDecisionContext, 'position', {
        finalResearchScore: Math.min(100, researchDecisionContext.researchScoreSummary.finalResearchScore + 4),
        trendAlignmentScore: Math.min(100, researchDecisionContext.researchScoreSummary.trendAlignmentScore + 3),
      }),
    ],
  }, { emitEvent: false }), [researchDecisionContext])
  const marketRegimeClassification = useMemo(() => classifyMarketRegime({
    symbol: scannerSignal.quote.symbol,
    assetType: scannerSignal.quote.assetType,
    marketData: {
      ...scannerSignal.quote,
      changePercent: 0.9,
    },
    marketDataAdapterHealth,
    researchIntelligence: marketIntelligence,
    researchSignalScore,
    multiTimeframeResearchContext,
  }, { emitEvent: false }), [marketDataAdapterHealth, marketIntelligence, multiTimeframeResearchContext, researchSignalScore, scannerSignal])
  const researchEnhancedDecision = useMemo(() => integrateResearchEnhancedDecision({
    baseDecisionInput: aiDecisionInput,
    marketIntelligence,
    researchSignalScore,
    researchDecisionContext,
    multiTimeframeContext: multiTimeframeResearchContext,
    marketRegime: marketRegimeClassification,
  }, { emitEvent: false }), [aiDecisionInput, marketIntelligence, marketRegimeClassification, multiTimeframeResearchContext, researchDecisionContext, researchSignalScore])
  const strategyBlueprintValidation = useMemo(() => validateStrategyBlueprint({
    id: 'index-pullback-research-v1',
    name: 'Index Pullback Research Blueprint',
    version: '1.0.0',
    metadata: {
      owner: 'Atlas Research Desk',
      description: 'Paper-only reusable blueprint for research-confirmed index pullbacks.',
      tags: ['index', 'research', 'paper'],
    },
    entryConditions: [
      {
        id: 'market-regime-risk-on',
        type: 'market_regime',
        operator: 'in',
        value: ['risk-on', 'neutral'],
        source: marketRegimeClassification.eventType,
        description: 'Market regime must not be risk-off.',
      },
      {
        id: 'research-score-threshold',
        type: 'research_score',
        operator: 'gte',
        value: 55,
        source: researchSignalScore.eventType,
        description: 'Research score must support paper trade review.',
      },
      {
        id: 'ai-research-decision',
        type: 'ai_decision',
        operator: 'in',
        value: ['approve', 'caution', 'watchlist'],
        source: researchEnhancedDecision.eventType,
        description: 'Research-enhanced AI decision must be usable.',
      },
    ],
    exitConditions: [
      {
        id: 'research-avoid-exit',
        type: 'research_bias',
        operator: 'eq',
        value: 'avoid',
        source: researchSignalScore.eventType,
        description: 'Exit review when research bias moves to avoid.',
      },
      {
        id: 'risk-off-exit',
        type: 'risk_state',
        operator: 'eq',
        value: 'risk-off',
        source: marketRegimeClassification.eventType,
        description: 'Exit review when market risk regime turns risk-off.',
      },
    ],
    riskRuleReferences: [
      { id: 'trade-guardrail', engine: 'tradeGuardrailEngine', reference: guardrails[0]?.result.eventType },
      { id: 'position-sizing', engine: 'positionSizingEngine', reference: positionSizing.eventType },
      { id: 'portfolio-risk', engine: 'portfolioRiskEngine', reference: risk.eventType },
    ],
    timeframeReferences: ['intraday', 'swing', 'position'],
    compatibleAssetClasses: ['equity', 'etf', 'futures'],
    aiDecision: researchEnhancedDecision,
    researchEnhancedDecision,
    marketRegime: marketRegimeClassification,
    portfolioRisk: risk,
    positionSizing,
  }, { emitEvent: false }), [guardrails, marketRegimeClassification, positionSizing, researchEnhancedDecision, researchSignalScore, risk])
  const strategyRuleEvaluation = useMemo(() => evaluateStrategyRules({
    strategyBlueprintValidation,
    symbol: demoProposedTrades[0].symbol,
    assetType: demoProposedTrades[0].assetType,
    timeframe: 'swing',
    researchDecisionContext,
    researchSignalScore,
    researchEnhancedDecision,
    marketRegime: marketRegimeClassification,
    portfolioRisk: risk,
    positionSizing,
    tradeGuardrail: guardrails[0]?.result,
    multiTimeframeContext: multiTimeframeResearchContext,
  }, { emitEvent: false }), [
    guardrails,
    marketRegimeClassification,
    multiTimeframeResearchContext,
    positionSizing,
    researchDecisionContext,
    researchEnhancedDecision,
    researchSignalScore,
    risk,
    strategyBlueprintValidation,
  ])
  const strategySignalComposition = useMemo(() => composeStrategySignal({
    strategyBlueprintValidation,
    strategyRuleEvaluation,
    symbol: demoProposedTrades[0].symbol,
    assetType: demoProposedTrades[0].assetType,
    timeframe: 'swing',
    researchDecisionContext,
    researchSignalScore,
    researchEnhancedDecision,
    marketRegime: marketRegimeClassification,
    portfolioRisk: risk,
    positionSizing,
  }, { emitEvent: false }), [
    marketRegimeClassification,
    positionSizing,
    researchDecisionContext,
    researchEnhancedDecision,
    researchSignalScore,
    risk,
    strategyBlueprintValidation,
    strategyRuleEvaluation,
  ])
  const strategyLifecycle = useMemo(() => updateStrategyLifecycle({
    strategyBlueprintValidation,
    strategyRuleEvaluation,
    strategySignalComposition,
    symbol: demoProposedTrades[0].symbol,
    assetType: demoProposedTrades[0].assetType,
    previousLifecycleState: 'validated',
    researchDecisionContext,
    researchSignalScore,
    researchEnhancedDecision,
    marketRegime: marketRegimeClassification,
    aiDecision,
  }, { emitEvent: false }), [
    aiDecision,
    marketRegimeClassification,
    researchDecisionContext,
    researchEnhancedDecision,
    researchSignalScore,
    strategyBlueprintValidation,
    strategyRuleEvaluation,
    strategySignalComposition,
  ])
  const strategyRegistry = useMemo(() => updateStrategyRegistry({
    strategyBlueprintValidation,
    strategyLifecycle,
    existingRecords: [
      {
        strategyId: 'crypto-breakout-paper-v1',
        strategyName: 'Crypto Breakout Paper',
        versionReference: '0.4.0',
        status: 'paused',
        lifecycleState: 'paused',
        validationStatus: 'valid',
        compatibleAssetClasses: ['crypto'],
        timeframeReferences: ['intraday'],
        tags: ['crypto', 'momentum'],
        metadata: {
          owner: 'Atlas Research Desk',
          description: 'Paused paper-only crypto breakout strategy.',
          createdBy: 'strategy-registry',
        },
        paperTrading: true,
      },
    ],
    filters: {
      status: 'active',
      assetClass: demoProposedTrades[0].assetType,
      timeframe: 'swing',
      tag: 'research',
    },
  }, { emitEvent: false }), [strategyBlueprintValidation, strategyLifecycle])
  const strategyBacktestInput = useMemo(() => prepareStrategyBacktestInput({
    strategyBlueprintValidation,
    strategyLifecycle,
    strategyRegistry,
    assetUniverse: [
      { symbol: demoProposedTrades[0].symbol, assetType: demoProposedTrades[0].assetType },
    ],
    timeframe: 'swing',
    dateRange: {
      startDate: '2025-01-01',
      endDate: '2025-06-30',
    },
    marketDataAdapterHealth,
    portfolioRisk: risk,
    positionSizing,
    capitalAllocation,
  }, { emitEvent: false }), [
    capitalAllocation,
    marketDataAdapterHealth,
    positionSizing,
    risk,
    strategyBlueprintValidation,
    strategyLifecycle,
    strategyRegistry,
  ])
  const historicalReplay = useMemo(() => prepareHistoricalReplayStep({
    strategyBacktestInput,
    marketDataAdapterHealth,
    cursorIndex: 2,
    historicalCandles: [
      { symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-01T00:00:00.000Z', open: 582.1, high: 586.4, low: 580.2, close: 585.2, volume: 66800000 },
      { symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-02T00:00:00.000Z', open: 585.2, high: 589.1, low: 583.7, close: 587.8, volume: 64200000 },
      { symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-03T00:00:00.000Z', open: 587.8, high: 591.3, low: 586.5, close: 590.4, volume: 61100000 },
      { symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-06T00:00:00.000Z', open: 590.4, high: 592.2, low: 588.9, close: 591.6, volume: 60400000 },
    ],
    now: '2025-01-07T00:00:00.000Z',
  }, { emitEvent: false }), [marketDataAdapterHealth, strategyBacktestInput])
  const strategyBacktestExecution = useMemo(() => executeStrategyBacktest({
    strategyBlueprintValidation,
    strategyBacktestInput,
    historicalReplay,
    researchDecisionContext,
    researchSignalScore,
    researchEnhancedDecision,
    marketRegime: marketRegimeClassification,
    portfolioRisk: risk,
    positionSizing,
    tradeGuardrail: guardrails[0]?.result,
    paperPortfolio: accountingDemoPortfolio,
  }, { emitEvent: false }), [
    guardrails,
    historicalReplay,
    marketRegimeClassification,
    positionSizing,
    researchDecisionContext,
    researchEnhancedDecision,
    researchSignalScore,
    risk,
    strategyBacktestInput,
    strategyBlueprintValidation,
  ])
  const strategyBacktestPerformance = useMemo(() => evaluateBacktestPerformance({
    strategyBacktestExecution,
    strategyBacktestInput,
    startingEquity: strategyBacktestInput.initialCapitalConfiguration.initialCapital,
  }, { emitEvent: false }), [strategyBacktestExecution, strategyBacktestInput])
  const strategyWalkForward = useMemo(() => evaluateWalkForwardTesting({
    historicalReplay,
    strategyBacktestExecution,
    strategyBacktestPerformance,
    inSampleWindowConfiguration: { size: 2, label: '2 candle calibration' },
    outOfSampleWindowConfiguration: { size: 1, label: '1 candle validation' },
  }, { emitEvent: false }), [historicalReplay, strategyBacktestExecution, strategyBacktestPerformance])
  const strategyMonteCarlo = useMemo(() => simulateMonteCarloStrategy({
    strategyBacktestPerformance,
    strategyWalkForward,
    drawdownProtection,
    riskAdjustedPerformance,
    simulationCount: 50,
    seed: 18,
  }, { emitEvent: false }), [drawdownProtection, riskAdjustedPerformance, strategyBacktestPerformance, strategyWalkForward])
  const strategyBacktestReport = useMemo(() => generateBacktestReport({
    strategyBacktestExecution,
    strategyBacktestPerformance,
    strategyWalkForward,
    strategyMonteCarlo,
  }, { emitEvent: false }), [strategyBacktestExecution, strategyBacktestPerformance, strategyMonteCarlo, strategyWalkForward])
  const portfolioCorrelation = useMemo(() => evaluatePortfolioCorrelation({
    portfolioAnalytics,
    strategyAttribution,
    strategyBacktestPerformance,
    historicalReplay,
    historicalPriceSeries: demoCorrelationPriceSeries,
  }, { emitEvent: false }), [historicalReplay, portfolioAnalytics, strategyAttribution, strategyBacktestPerformance])
  const portfolioFactorExposure = useMemo(() => evaluatePortfolioFactorExposure({
    portfolioAnalytics,
    portfolioCorrelation,
    strategyAttribution,
    marketRegime: marketRegimeClassification,
    strategyBacktestPerformance,
    positions: demoPortfolio.positions,
    factorInputs: [
      { symbol: 'SPY', momentumScore: 68 },
      { symbol: 'AAPL', momentumScore: 72 },
      { symbol: 'BTC-USD', momentumScore: 82 },
      { symbol: 'EURUSD', momentumScore: 58 },
      { symbol: 'ES', momentumScore: 44 },
    ],
  }, { emitEvent: false }), [marketRegimeClassification, portfolioAnalytics, portfolioCorrelation, strategyAttribution, strategyBacktestPerformance])
  const portfolioOptimization = useMemo(() => recommendPortfolioOptimization({
    portfolioAnalytics,
    portfolioCorrelation,
    portfolioFactorExposure,
    capitalAllocation,
    portfolioRisk: risk,
    performance,
    strategyAttribution,
  }, { emitEvent: false }), [capitalAllocation, performance, portfolioAnalytics, portfolioCorrelation, portfolioFactorExposure, risk, strategyAttribution])
  const portfolioOptimizationGovernance = useMemo(() => reviewPortfolioOptimizationGovernance({
    portfolioOptimization,
    portfolioRisk: risk,
    portfolioCorrelation,
    portfolioFactorExposure,
    capitalAllocation,
    aiDecision,
  }, { emitEvent: false }), [aiDecision, capitalAllocation, portfolioCorrelation, portfolioFactorExposure, portfolioOptimization, risk])
  const eventObservability = useMemo(() => observeSystemEvents({
    eventOutputs: {
      marketDataAdapterHealth,
      brokerAdapterHealth,
      releaseReadiness,
      releaseCandidateStabilization,
      risk,
      tradeGuardrail: guardrails[0]?.result,
      execution: executions[0]?.result,
      accounting: primaryAccounting,
      journal: journalRecords[0]?.result,
      performance,
      riskAdjustedPerformance,
      drawdownProtection,
      positionSizing,
      capitalAllocation,
      aiDecision,
      marketIntelligence,
      researchSignalScore,
      researchDecisionContext,
      multiTimeframeResearchContext,
      marketRegimeClassification,
      researchEnhancedDecision,
      strategyBlueprintValidation,
      strategyRuleEvaluation,
      strategySignalComposition,
      strategyLifecycle,
      strategyRegistry,
      strategyBacktestInput,
      historicalReplay,
      strategyBacktestExecution,
      strategyBacktestPerformance,
      strategyWalkForward,
      strategyMonteCarlo,
      strategyBacktestReport,
      strategyPortfolioManager,
      strategyAttribution,
      portfolioAnalytics,
      portfolioCorrelation,
      portfolioFactorExposure,
      portfolioOptimization,
      portfolioOptimizationGovernance,
      rebalancing,
    },
    releaseReadiness,
    releaseCandidateStabilization,
    requiredEventTypes: [
      'marketData.adapter.checked',
      'broker.adapter.checked',
      'portfolio.risk.evaluated',
      'trade.guardrail.evaluated',
      'trade.execution.simulated',
      'ai.decision.orchestrated',
      'research.marketIntelligence.evaluated',
      'strategy.signal.composed',
      'strategy.backtestPerformance.evaluated',
      'portfolio.optimizationGovernance.reviewed',
      'system.releaseReadiness.evaluated',
      'system.releaseCandidate.stabilized',
    ],
  }, { emitEvent: false }), [
    aiDecision,
    brokerAdapterHealth,
    capitalAllocation,
    drawdownProtection,
    eventTimeline,
    executions,
    guardrails,
    historicalReplay,
    journalRecords,
    marketDataAdapterHealth,
    marketIntelligence,
    marketRegimeClassification,
    multiTimeframeResearchContext,
    performance,
    portfolioAnalytics,
    portfolioCorrelation,
    portfolioFactorExposure,
    portfolioOptimization,
    portfolioOptimizationGovernance,
    positionSizing,
    primaryAccounting,
    rebalancing,
    releaseCandidateStabilization,
    releaseReadiness,
    researchDecisionContext,
    researchEnhancedDecision,
    researchSignalScore,
    risk,
    riskAdjustedPerformance,
    strategyAttribution,
    strategyBacktestExecution,
    strategyBacktestInput,
    strategyBacktestPerformance,
    strategyBacktestReport,
    strategyBlueprintValidation,
    strategyLifecycle,
    strategyMonteCarlo,
    strategyPortfolioManager,
    strategyRegistry,
    strategyRuleEvaluation,
    strategySignalComposition,
    strategyWalkForward,
  ])
  const systemHealthCommandCenter = useMemo(() => evaluateSystemHealthCommandCenter({
    portfolioRisk: risk,
    tradeGuardrail: guardrails[0]?.result,
    executionSimulation: executions[0]?.result,
    accounting: primaryAccounting,
    journal: journalRecords[0]?.result,
    aiDecision,
    marketIntelligence,
    researchSignalScore,
    researchDecisionContext,
    multiTimeframeResearch: multiTimeframeResearchContext,
    marketRegime: marketRegimeClassification,
    researchEnhancedDecision,
    strategyBlueprint: strategyBlueprintValidation,
    strategyRuleEvaluation,
    strategySignal: strategySignalComposition,
    strategyLifecycle,
    strategyRegistry,
    strategyPortfolioManager,
    strategyBacktestInput,
    historicalReplay,
    strategyBacktestExecution,
    strategyBacktestPerformance,
    strategyWalkForward,
    strategyMonteCarlo,
    strategyBacktestReport,
    portfolioAnalytics,
    portfolioCorrelation,
    portfolioFactorExposure,
    portfolioOptimization,
    portfolioOptimizationGovernance,
    rebalancing,
    strategyAttribution,
    marketDataAdapterHealth,
    brokerAdapterHealth,
    releaseReadiness,
    releaseCandidateStabilization,
    eventObservability,
  }, { emitEvent: false }), [
    aiDecision,
    brokerAdapterHealth,
    eventObservability,
    executions,
    guardrails,
    historicalReplay,
    journalRecords,
    marketDataAdapterHealth,
    marketIntelligence,
    marketRegimeClassification,
    multiTimeframeResearchContext,
    portfolioAnalytics,
    portfolioCorrelation,
    portfolioFactorExposure,
    portfolioOptimization,
    portfolioOptimizationGovernance,
    primaryAccounting,
    rebalancing,
    releaseCandidateStabilization,
    releaseReadiness,
    researchDecisionContext,
    researchEnhancedDecision,
    researchSignalScore,
    risk,
    strategyAttribution,
    strategyBacktestExecution,
    strategyBacktestInput,
    strategyBacktestPerformance,
    strategyBacktestReport,
    strategyBlueprintValidation,
    strategyLifecycle,
    strategyMonteCarlo,
    strategyPortfolioManager,
    strategyRegistry,
    strategyRuleEvaluation,
    strategySignalComposition,
    strategyWalkForward,
  ])
  const operatorActionCenter = useMemo(() => generateOperatorActions({
    systemHealthCommandCenter,
    eventObservability,
    portfolioOptimizationGovernance,
    drawdownProtection,
    portfolioRisk: risk,
    marketDataAdapterHealth,
    brokerAdapterHealth,
    releaseReadiness,
  }, { emitEvent: false }), [
    brokerAdapterHealth,
    drawdownProtection,
    eventObservability,
    marketDataAdapterHealth,
    portfolioOptimizationGovernance,
    releaseReadiness,
    risk,
    systemHealthCommandCenter,
  ])
  const enterpriseAuditTrail = useMemo(() => recordEnterpriseAuditTrail({
    eventObservability,
    operatorActionCenter,
    strategyLifecycle,
    portfolioRisk: risk,
    tradeGuardrail: guardrails[0]?.result,
    releaseReadiness,
    systemHealthCommandCenter,
  }, { emitEvent: false }), [
    eventObservability,
    guardrails,
    operatorActionCenter,
    releaseReadiness,
    risk,
    strategyLifecycle,
    systemHealthCommandCenter,
  ])
  const enterpriseReleaseControl = useMemo(() => evaluateEnterpriseReleaseControl({
    releaseReadiness,
    releaseCandidateStabilization,
    systemHealthCommandCenter,
    eventObservability,
    operatorActionCenter,
    enterpriseAuditTrail,
  }, { emitEvent: false }), [
    enterpriseAuditTrail,
    eventObservability,
    operatorActionCenter,
    releaseCandidateStabilization,
    releaseReadiness,
    systemHealthCommandCenter,
  ])
  const workspaceNavigationBase = [
    { id: 'market-data-health', label: 'Market Data', status: marketDataAdapterHealth.health.status },
    { id: 'market-regime', label: 'Regime', status: marketRegimeClassification.riskRegime.regime },
    { id: 'broker-adapter-health', label: 'Broker Adapter', status: brokerAdapterHealth.health.status },
    { id: 'research-intelligence', label: 'Research Intel', status: marketIntelligence.riskSentimentSummary.label },
    { id: 'research-signal-score', label: 'Research Score', status: researchSignalScore.decisionBias },
    { id: 'research-decision-context', label: 'Research Context', status: researchDecisionContext.decisionBiasSummary.recommendedUse },
    { id: 'multi-timeframe-research', label: 'Timeframes', status: multiTimeframeResearchContext.dominantTimeframeBias.bias },
    { id: 'research-enhanced-decision', label: 'Research AI', status: researchEnhancedDecision.finalResearchAwareDecisionSummary.finalDecision },
    { id: 'strategy-builder', label: 'Strategy Builder', status: strategyBlueprintValidation.validationStatus },
    { id: 'strategy-rule-evaluation', label: 'Rule Eval', status: strategyRuleEvaluation.strategyEvaluationStatus },
    { id: 'strategy-signal-composer', label: 'Strategy Signal', status: strategySignalComposition.signalStatus },
    { id: 'strategy-lifecycle', label: 'Lifecycle', status: strategyLifecycle.lifecycleState },
    { id: 'strategy-registry', label: 'Registry', status: strategyRegistry.activeStrategyCount },
    { id: 'strategy-backtest-input', label: 'Backtest Input', status: strategyBacktestInput.readinessStatus },
    { id: 'historical-replay', label: 'Replay', status: historicalReplay.replayStepOutput.status },
    { id: 'strategy-backtest-execution', label: 'Backtest Run', status: strategyBacktestExecution.backtestExecutionStatus },
    { id: 'strategy-backtest-performance', label: 'Backtest Perf', status: strategyBacktestPerformance.analyticsStatus },
    { id: 'strategy-walk-forward', label: 'Walk Forward', status: strategyWalkForward.finalWalkForwardStatus },
    { id: 'strategy-monte-carlo', label: 'Monte Carlo', status: strategyMonteCarlo.robustnessClassification },
    { id: 'strategy-backtest-report', label: 'Backtest Report', status: strategyBacktestReport.releaseResearchRecommendation },
    { id: 'release-readiness', label: 'Release RC', status: releaseReadiness.releaseReadinessStatus },
    { id: 'rc-stabilization', label: 'RC Stability', status: releaseCandidateStabilization.finalStatus },
    { id: 'scanner-signal', label: 'Scanner / Signal', status: scannerSignal.signal.action },
    { id: 'ai-decision', label: 'AI Decision', status: aiDecision.finalDecision },
    { id: 'risk', label: 'Risk', status: risk.summary.riskLevel },
    { id: 'position-sizing', label: 'Sizing', status: positionSizing.status },
    { id: 'guardrails', label: 'Guardrails', status: guardrails[0]?.result.decision ?? 'review' },
    { id: 'execution', label: 'Execution', status: executions[0]?.result.finalStatus ?? 'pending' },
    { id: 'accounting', label: 'Accounting', status: primaryAccounting?.status ?? 'ready' },
    { id: 'journal', label: 'Journal', status: journalRecords[0]?.result.journalStatus ?? 'ready' },
    { id: 'performance', label: 'Performance', status: performance.metrics.totalTrades },
    { id: 'portfolio-analytics', label: 'Analytics', status: portfolioAnalytics.diversification.label },
    { id: 'portfolio-correlation', label: 'Correlation', status: portfolioCorrelation.correlationRiskStatus },
    { id: 'portfolio-factor-exposure', label: 'Factors', status: portfolioFactorExposure.factorRiskStatus },
    { id: 'portfolio-optimization', label: 'Optimization', status: portfolioOptimization.recommendationPriority },
    { id: 'portfolio-optimization-governance', label: 'Governance', status: portfolioOptimizationGovernance.governanceStatus },
    { id: 'event-observability', label: 'Observability', status: eventObservability.observabilityStatus },
    { id: 'system-health-command-center', label: 'System Health', status: systemHealthCommandCenter.finalPlatformHealthStatus },
    { id: 'operator-action-center', label: 'Operator Actions', status: operatorActionCenter.platformActionSummary.topSeverity },
    { id: 'enterprise-audit-trail', label: 'Audit Trail', status: enterpriseAuditTrail.auditIntegrityStatus.status },
    { id: 'enterprise-release-control', label: 'Release Control', status: enterpriseReleaseControl.finalReleaseStatus },
    { id: 'drawdown-protection', label: 'Drawdown', status: drawdownProtection.protectionStatus },
    { id: 'multi-strategy', label: 'Strategies', status: strategyPortfolioManager.strategyApprovalStatus },
    { id: 'event-timeline', label: 'Events', status: eventTimeline.length },
  ]
  const workspacePersistence = useMemo(() => prepareWorkspacePersistence({
    dashboardNavigation: workspaceNavigationBase,
    activePanelId: 'enterprise-release-control',
    operatorPreferences: {
      theme: 'system',
      density: 'operator',
      defaultLandingPanel: 'enterprise-release-control',
      eventRefreshMode: 'manual',
    },
    enterpriseReleaseControl,
    systemHealthCommandCenter,
    operatorActionCenter,
  }, { emitEvent: false }), [
    enterpriseReleaseControl,
    operatorActionCenter,
    systemHealthCommandCenter,
    workspaceNavigationBase,
  ])
  const workspaceNavigation = [
    ...workspaceNavigationBase,
    { id: 'workspace-persistence', label: 'Persistence', status: workspacePersistence.persistenceStatus },
  ]

  return (
    <main className="risk-dashboard">
      <header className="risk-header">
        <div>
          <p className="eyebrow">Atlas Market</p>
          <h1>Portfolio Risk Intelligence</h1>
          <p className="header-copy">
            Asset-agnostic paper portfolio risk evaluation across exposure, concentration, leverage,
            volatility, liquidity, and open risk.
          </p>
          <p className="workspace-line">
            Institutional Trading Workspace integration: Watchlist, Market Overview, Signal Panel, Risk Panel,
            Order Entry, Portfolio Summary, and Portfolio controls remain paper-mode aligned.
          </p>
        </div>
        <div className="header-status" aria-label="Portfolio risk status">
          <span className="paper-pill">Paper Trading only</span>
          <span className={`risk-pill ${riskTone}`}>{risk.summary.riskLevel}</span>
          <span className="timestamp">Evaluated {formatDate(risk.timestamp)}</span>
        </div>
      </header>

      <section className="hero-grid" aria-label="Portfolio risk summary">
        <article className="score-panel">
          <span>Risk Score</span>
          <strong>{formatNumber(risk.summary.riskScore)}</strong>
          <p>{risk.eventType}</p>
        </article>
        <MetricCard label="Account Value" value={formatCurrency(risk.account.accountValue)} />
        <MetricCard label="Cash" value={formatCurrency(risk.account.cash)} />
        <MetricCard label="Buying Power" value={formatCurrency(risk.account.buyingPower)} />
        <MetricCard label="Open Risk" value={formatCurrency(risk.summary.openRisk)} tone={risk.summary.openRiskPct > 2 ? 'warning' : ''} />
      </section>

      <WorkspaceLayout navigation={workspaceNavigation}>
        <Suspense fallback={<PanelLoadingFallback />}>
        <article id="market-data-health" className={`panel market-data-health-panel ${marketDataAdapterHealth.health.status}`}>
          <div className="panel-heading">
            <h2>Market Data Health</h2>
            <span>Mock adapter default. Paper trading only.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{marketDataAdapterHealth.metadata.name}</span>
              <strong>{marketDataAdapterHealth.health.status}</strong>
            </div>
            <span className={`decision-pill ${marketDataAdapterHealth.health.status === 'healthy' ? 'positive' : marketDataAdapterHealth.health.status === 'stale' ? 'warning' : 'danger'}`}>
              {marketDataAdapterHealth.metadata.id}
            </span>
          </div>
          <div className="market-data-health-grid">
            <MetricCard label="Provider" value={marketDataAdapterHealth.health.provider} />
            <MetricCard label="Available" value={marketDataAdapterHealth.health.available ? 'yes' : 'no'} />
            <MetricCard label="Stale Data" value={marketDataAdapterHealth.health.stale ? 'yes' : 'no'} />
            <MetricCard label="Capabilities" value={formatNumber(marketDataAdapterHealth.metadata.capabilities.length)} />
            <MetricCard label="Asset Types" value={formatNumber(marketDataAdapterHealth.metadata.assetTypes.length)} />
            <MetricCard label="Paper Mode" value={marketDataAdapterHealth.health.paperTrading ? 'enabled' : 'disabled'} />
          </div>
          <p className="empty-state">No paid data API is required for this adapter foundation.</p>
          <span className="event-line">{marketDataAdapterHealth.eventType}</span>
        </article>

        <article id="market-regime" className={`panel market-regime-panel ${marketRegimeClassification.riskRegime.regime}`}>
          <div className="panel-heading">
            <h2>Market Regime</h2>
            <span>Classified market conditions for AI paper-decision context.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{marketRegimeClassification.symbol} {marketRegimeClassification.assetType}</span>
              <strong>{marketRegimeClassification.compositeRegimeLabel}</strong>
            </div>
            <span className={`decision-pill ${marketRegimeClassification.riskRegime.regime === 'risk-on' ? 'positive' : marketRegimeClassification.riskRegime.regime === 'risk-off' ? 'danger' : 'warning'}`}>
              {formatNumber(marketRegimeClassification.regimeConfidenceScore)} confidence
            </span>
          </div>
          <p className="empty-state">{marketRegimeClassification.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Trend Regime" value={marketRegimeClassification.trendRegime.regime} />
            <MetricCard label="Volatility Regime" value={marketRegimeClassification.volatilityRegime.regime} />
            <MetricCard label="Risk Regime" value={marketRegimeClassification.riskRegime.regime} />
            <MetricCard label="Liquidity Regime" value={marketRegimeClassification.liquidityRegime.regime} />
            <MetricCard label="Composite Label" value={marketRegimeClassification.compositeRegimeLabel} />
            <MetricCard label="AI Compatible" value={marketRegimeClassification.aiDecisionCompatibility.compatibleWithAIDecisionOrchestrator ? 'yes' : 'no'} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Trend</span>
                <strong>{marketRegimeClassification.trendRegime.direction}</strong>
              </div>
              <p>{marketRegimeClassification.trendRegime.summary}</p>
            </section>
            <section>
              <div>
                <span>Volatility</span>
                <strong>{marketRegimeClassification.volatilityRegime.sourceLabel}</strong>
              </div>
              <p>{marketRegimeClassification.volatilityRegime.summary}</p>
            </section>
            <section>
              <div>
                <span>Liquidity</span>
                <strong>{marketRegimeClassification.liquidityRegime.regime}</strong>
              </div>
              <p>{marketRegimeClassification.liquidityRegime.summary}</p>
            </section>
          </div>
          <span className="event-line">{marketRegimeClassification.eventType}</span>
        </article>

        <article id="broker-adapter-health" className={`panel broker-adapter-health-panel ${brokerAdapterHealth.health.status}`}>
          <div className="panel-heading">
            <h2>Broker Adapter Health</h2>
            <span>Mock paper broker default. No live orders or real brokerage connection.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{brokerAdapterHealth.metadata.name}</span>
              <strong>{brokerAdapterHealth.health.status}</strong>
            </div>
            <span className={`decision-pill ${brokerAdapterHealth.health.status === 'healthy' ? 'positive' : brokerAdapterHealth.health.status === 'degraded' ? 'warning' : 'danger'}`}>
              {brokerAdapterHealth.metadata.id}
            </span>
          </div>
          <div className="broker-adapter-grid">
            <MetricCard label="Account Equity" value={formatCurrency(brokerAdapterHealth.account.equity)} />
            <MetricCard label="Cash" value={formatCurrency(brokerAdapterHealth.account.cash)} />
            <MetricCard label="Buying Power" value={formatCurrency(brokerAdapterHealth.account.buyingPower)} />
            <MetricCard label="Positions" value={formatNumber(brokerAdapterHealth.positions.length)} />
            <MetricCard label="Last Paper Order" value={brokerAdapterHealth.lastSimulatedOrder.status} />
            <MetricCard label="Live Orders" value={brokerAdapterHealth.health.liveOrders ? 'enabled' : 'disabled'} />
          </div>
          <div className="broker-adapter-summary">
            <section>
              <span>Normalized fill</span>
              <strong>{brokerAdapterHealth.lastSimulatedOrder.fill ? `${brokerAdapterHealth.lastSimulatedOrder.fill.symbol} ${formatNumber(brokerAdapterHealth.lastSimulatedOrder.fill.quantity)} ${brokerAdapterHealth.lastSimulatedOrder.fill.quantityTerm}` : 'No fill'}</strong>
            </section>
            <section>
              <span>Capabilities</span>
              <strong>{brokerAdapterHealth.metadata.capabilities.join(' / ')}</strong>
            </section>
          </div>
          <p className="empty-state">Broker adapter output is paper-only and fed by simulated execution plus accounting snapshots.</p>
          <span className="event-line">{brokerAdapterHealth.eventType}</span>
        </article>

        <article id="research-intelligence" className="panel research-intelligence-panel">
          <div className="panel-heading">
            <h2>Research Intelligence</h2>
            <span>Mock research context before paper-trading decisions.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{marketIntelligence.symbol} {marketIntelligence.assetType}</span>
              <strong>{marketIntelligence.marketRegimeSummary.label}</strong>
            </div>
            <span className={`decision-pill ${marketIntelligence.riskSentimentSummary.label === 'supportive' ? 'positive' : marketIntelligence.riskSentimentSummary.label === 'mixed' ? 'warning' : 'danger'}`}>
              {formatPercent(marketIntelligence.confidenceScore)} confidence
            </span>
          </div>
          <p className="empty-state">{marketIntelligence.researchBrief}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Market Regime" value={marketIntelligence.marketRegimeSummary.label} />
            <MetricCard label="Volatility" value={marketIntelligence.volatilityContext.label} />
            <MetricCard label="Trend" value={marketIntelligence.trendContext.direction} />
            <MetricCard label="Risk Sentiment" value={marketIntelligence.riskSentimentSummary.label} />
            <MetricCard label="Catalysts" value={`${formatNumber(marketIntelligence.catalystSummary.count)} ${marketIntelligence.catalystSummary.dominantSentiment}`} />
            <MetricCard label="Release Gate" value={marketIntelligence.riskSentimentSummary.releaseStatus} />
            <MetricCard label="Input Mode" value={marketIntelligence.researchInputSummary.mode} />
            <MetricCard label="Paper Readiness" value={marketIntelligence.decisionReadiness.status} />
          </div>
          <p className="empty-state">{marketIntelligence.researchInputSummary.summary}</p>
          <div className="research-catalyst-list">
            {marketIntelligence.catalysts.map((catalyst) => (
              <section key={`${catalyst.type}-${catalyst.title}`}>
                <div>
                  <span>{catalyst.type}</span>
                  <strong>{catalyst.sentiment}</strong>
                </div>
                <p>{catalyst.title}</p>
                <span>{formatPercent(catalyst.confidence)} confidence</span>
              </section>
            ))}
          </div>
          <span className="event-line">{marketIntelligence.eventType}</span>
        </article>

        <article id="research-signal-score" className={`panel research-signal-score-panel ${researchSignalScore.decisionBias}`}>
          <div className="panel-heading">
            <h2>Research Signal Score</h2>
            <span>Normalized research context for paper-trading decisions.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{researchSignalScore.symbol} {researchSignalScore.assetType}</span>
              <strong>{researchSignalScore.decisionBias}</strong>
            </div>
            <span className={`decision-pill ${researchSignalScore.decisionBias === 'bullish' ? 'positive' : researchSignalScore.decisionBias === 'avoid' || researchSignalScore.decisionBias === 'bearish' ? 'danger' : 'warning'}`}>
              {formatNumber(researchSignalScore.finalResearchScore)} final score
            </span>
          </div>
          <p className="empty-state">{researchSignalScore.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Bullish" value={formatNumber(researchSignalScore.bullishScore)} />
            <MetricCard label="Bearish" value={formatNumber(researchSignalScore.bearishScore)} />
            <MetricCard label="Neutral" value={formatNumber(researchSignalScore.neutralScore)} />
            <MetricCard label="Catalyst Strength" value={formatNumber(researchSignalScore.catalystStrengthScore)} />
            <MetricCard label="Trend Alignment" value={formatNumber(researchSignalScore.trendAlignmentScore)} />
            <MetricCard label="Risk Adjustment" value={formatNumber(researchSignalScore.riskSentimentAdjustment.adjustment)} />
            <MetricCard label="Volatility Adjustment" value={formatNumber(researchSignalScore.volatilityAdjustment.adjustment)} />
            <MetricCard label="Decision Bias" value={researchSignalScore.decisionBias} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Volatility</span>
                <strong>{researchSignalScore.volatilityAdjustment.label}</strong>
              </div>
              <p>{researchSignalScore.volatilityAdjustment.summary}</p>
            </section>
            <section>
              <div>
                <span>Trend</span>
                <strong>{researchSignalScore.components.trendAlignment.direction}</strong>
              </div>
              <p>{researchSignalScore.components.trendAlignment.summary}</p>
            </section>
            <section>
              <div>
                <span>Risk Sentiment</span>
                <strong>{researchSignalScore.riskSentimentAdjustment.label}</strong>
              </div>
              <p>{researchSignalScore.riskSentimentAdjustment.summary}</p>
            </section>
          </div>
          <span className="event-line">{researchSignalScore.eventType}</span>
        </article>

        <article id="research-decision-context" className={`panel research-decision-context-panel ${researchDecisionContext.decisionBiasSummary.decisionBias}`}>
          <div className="panel-heading">
            <h2>Research Decision Context</h2>
            <span>AI-compatible research package for paper decisions.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{researchDecisionContext.symbol} {researchDecisionContext.assetType}</span>
              <strong>{researchDecisionContext.decisionBiasSummary.recommendedUse}</strong>
            </div>
            <span className={`decision-pill ${researchDecisionContext.decisionBiasSummary.avoid ? 'danger' : researchDecisionContext.decisionBiasSummary.directional ? 'positive' : 'warning'}`}>
              {researchDecisionContext.decisionBiasSummary.confidenceBand} confidence
            </span>
          </div>
          <p className="empty-state">{researchDecisionContext.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Final Research Score" value={formatNumber(researchDecisionContext.researchScoreSummary.finalResearchScore)} />
            <MetricCard label="Decision Bias" value={researchDecisionContext.decisionBiasSummary.decisionBias} />
            <MetricCard label="Catalyst Context" value={researchDecisionContext.catalystContextSummary.dominantSentiment} />
            <MetricCard label="Volatility" value={researchDecisionContext.marketContextSummary.volatility.label} />
            <MetricCard label="Trend" value={researchDecisionContext.marketContextSummary.trend.direction} />
            <MetricCard label="Risk Sentiment" value={researchDecisionContext.marketContextSummary.riskSentiment.label} />
            <MetricCard label="AI Compatible" value={researchDecisionContext.aiDecisionCompatibility.compatibleWithAIDecisionOrchestrator ? 'yes' : 'no'} />
            <MetricCard label="Paper Mode" value={researchDecisionContext.aiDecisionCompatibility.paperTrading ? 'enabled' : 'disabled'} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Scanner Signal</span>
                <strong>{researchDecisionContext.aiDecisionCompatibility.scannerSignal.direction}</strong>
              </div>
              <p>{researchDecisionContext.aiDecisionCompatibility.scannerSignal.source} score {formatNumber(researchDecisionContext.aiDecisionCompatibility.scannerSignal.score)}</p>
            </section>
            <section>
              <div>
                <span>Catalysts</span>
                <strong>{formatNumber(researchDecisionContext.catalystContextSummary.count)}</strong>
              </div>
              <p>{researchDecisionContext.catalystContextSummary.summary}</p>
            </section>
            <section>
              <div>
                <span>Recommended Use</span>
                <strong>{researchDecisionContext.decisionBiasSummary.recommendedUse}</strong>
              </div>
              <p>{researchDecisionContext.decisionBiasSummary.summary}</p>
            </section>
          </div>
          <span className="event-line">{researchDecisionContext.eventType}</span>
        </article>

        <article id="multi-timeframe-research" className={`panel multi-timeframe-research-panel ${multiTimeframeResearchContext.dominantTimeframeBias.bias}`}>
          <div className="panel-heading">
            <h2>Multi-Timeframe Research</h2>
            <span>Intraday, swing, and position research context alignment.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{multiTimeframeResearchContext.symbol} {multiTimeframeResearchContext.assetType}</span>
              <strong>{multiTimeframeResearchContext.dominantTimeframeBias.bias}</strong>
            </div>
            <span className={`decision-pill ${multiTimeframeResearchContext.conflictDetection.hasConflicts ? 'warning' : 'positive'}`}>
              {multiTimeframeResearchContext.conflictDetection.conflictCount} conflicts
            </span>
          </div>
          <p className="empty-state">{multiTimeframeResearchContext.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Dominant Bias" value={multiTimeframeResearchContext.dominantTimeframeBias.bias} />
            <MetricCard label="Dominant Bucket" value={multiTimeframeResearchContext.dominantTimeframeBias.dominantBucket} />
            <MetricCard label="Trend Summary" value={multiTimeframeResearchContext.timeframeTrendSummary.dominantDirection} />
            <MetricCard label="Volatility" value={multiTimeframeResearchContext.timeframeVolatilitySummary.overallLabel} />
            <MetricCard label="Average Score" value={formatNumber(multiTimeframeResearchContext.timeframeResearchScoreAlignment.averageScore)} />
            <MetricCard label="Score Alignment" value={multiTimeframeResearchContext.timeframeResearchScoreAlignment.aligned ? 'aligned' : 'conflict'} />
            <MetricCard label="AI Compatible" value={multiTimeframeResearchContext.aiDecisionCompatibility.compatibleWithAIDecisionOrchestrator ? 'yes' : 'no'} />
            <MetricCard label="Paper Mode" value={multiTimeframeResearchContext.paperTrading ? 'enabled' : 'disabled'} />
          </div>
          <div className="research-catalyst-list">
            {multiTimeframeResearchContext.timeframeBuckets.map((timeframe) => (
              <section key={timeframe.bucket}>
                <div>
                  <span>{timeframe.bucket}</span>
                  <strong>{timeframe.decisionBias}</strong>
                </div>
                <p>
                  Trend {timeframe.trend.direction}; volatility {timeframe.volatility.label}; score {formatNumber(timeframe.researchScore)}.
                </p>
              </section>
            ))}
          </div>
          <span className="event-line">{multiTimeframeResearchContext.eventType}</span>
        </article>

        <article id="research-enhanced-decision" className={`panel research-enhanced-decision-panel ${researchEnhancedDecision.finalResearchAwareDecisionSummary.finalDecision}`}>
          <div className="panel-heading">
            <h2>Research-Enhanced AI Decision</h2>
            <span>Phase 16 research stack integrated with the AI Decision Orchestrator.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{researchEnhancedDecision.symbol} {researchEnhancedDecision.assetType}</span>
              <strong>{researchEnhancedDecision.finalResearchAwareDecisionSummary.finalDecision}</strong>
            </div>
            <span className={`decision-pill ${researchEnhancedDecision.finalResearchAwareDecisionSummary.finalDecision === 'approve' ? 'positive' : researchEnhancedDecision.finalResearchAwareDecisionSummary.finalDecision === 'reject' ? 'danger' : 'warning'}`}>
              {formatNumber(researchEnhancedDecision.researchInfluenceScore)} influence
            </span>
          </div>
          <p className="empty-state">{researchEnhancedDecision.decisionAdjustmentRationale}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Base Decision" value={researchEnhancedDecision.finalResearchAwareDecisionSummary.baseDecision} />
            <MetricCard label="Research Decision" value={researchEnhancedDecision.finalResearchAwareDecisionSummary.finalDecision} />
            <MetricCard label="Market Intel" value={researchEnhancedDecision.marketIntelligenceSummary.riskSentiment} />
            <MetricCard label="Research Score" value={formatNumber(researchEnhancedDecision.researchSignalScoreSummary.finalResearchScore)} />
            <MetricCard label="Decision Context" value={researchEnhancedDecision.researchDecisionContextSummary.recommendedUse} />
            <MetricCard label="Timeframe Bias" value={researchEnhancedDecision.multiTimeframeContextSummary.dominantBias} />
            <MetricCard label="Market Regime" value={researchEnhancedDecision.marketRegimeSummary.riskRegime} />
            <MetricCard label="Event Output" value={researchEnhancedDecision.eventType} />
          </div>
          {researchEnhancedDecision.blockers.length > 0 || researchEnhancedDecision.cautions.length > 0 ? (
            <ul className="warning-list">
              {[...researchEnhancedDecision.blockers, ...researchEnhancedDecision.cautions].map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <p className="empty-state">Research stack confirms the paper decision context.</p>
          )}
          <span className="event-line">{researchEnhancedDecision.eventType}</span>
        </article>

        <article id="release-readiness" className={`panel release-readiness-panel ${releaseReadiness.releaseReadinessStatus}`}>
          <div className="panel-heading">
            <h2>Release Readiness</h2>
            <span>Production readiness gate for the paper-trading release candidate.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Release readiness status</span>
              <strong>{releaseReadiness.releaseReadinessStatus}</strong>
            </div>
            <span className={`decision-pill ${releaseReadiness.releaseReadinessStatus === 'ready' ? 'positive' : releaseReadiness.releaseReadinessStatus === 'caution' ? 'warning' : 'danger'}`}>
              paper only
            </span>
          </div>
          <p className="empty-state">{releaseReadiness.summary}</p>
          <div className="release-readiness-grid">
            {releaseReadiness.checks.map((check) => (
              <MetricCard
                key={check.name}
                label={check.name}
                value={check.status}
                tone={check.status === 'ready' ? 'positive' : check.status === 'caution' ? 'warning' : 'danger'}
              />
            ))}
          </div>
          <div className="release-readiness-list">
            {releaseReadiness.checks.map((check) => (
              <section key={`${check.name}-${check.status}`}>
                <div>
                  <span>{check.name}</span>
                  <strong>{check.status}</strong>
                </div>
                <p>{check.message}</p>
              </section>
            ))}
          </div>
          <div className="release-validation-summary">
            <MetricCard label="Test Command" value="npm test" />
            <MetricCard label="Build Command" value="npm run build" />
            <MetricCard label="Event Output" value={releaseReadiness.eventType} />
          </div>
          <span className="event-line">{releaseReadiness.eventType}</span>
        </article>

        <article id="rc-stabilization" className={`panel rc-stabilization-panel ${releaseCandidateStabilization.finalStatus}`}>
          <div className="panel-heading">
            <h2>RC Stabilization</h2>
            <span>Final stabilization pass for the paper-trading operating system.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Final status</span>
              <strong>{releaseCandidateStabilization.finalStatus}</strong>
            </div>
            <span className={`decision-pill ${releaseCandidateStabilization.finalStatus === 'stable' ? 'positive' : releaseCandidateStabilization.finalStatus === 'caution' ? 'warning' : 'danger'}`}>
              mock mode locked
            </span>
          </div>
          <p className="empty-state">{releaseCandidateStabilization.summary}</p>
          <div className="rc-stabilization-grid">
            {releaseCandidateStabilization.checks.map((check) => (
              <MetricCard
                key={check.name}
                label={check.name}
                value={check.status}
                tone={check.status === 'stable' ? 'positive' : check.status === 'caution' ? 'warning' : 'danger'}
              />
            ))}
          </div>
          <div className="rc-stabilization-columns">
            <section>
              <h3>Critical Module Health</h3>
              {releaseCandidateStabilization.criticalModuleHealthSummary.modules.slice(0, 5).map((module) => (
                <div key={module.name} className="mini-row">
                  <span>{module.name}</span>
                  <strong>{module.status}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Dashboard Smoke Tests</h3>
              {releaseCandidateStabilization.dashboardSmokeTestSummary.smokeTests.slice(0, 5).map((smokeTest) => (
                <div key={smokeTest.name} className="mini-row">
                  <span>{smokeTest.panel}</span>
                  <strong>{smokeTest.status}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Release Blockers</h3>
              {releaseCandidateStabilization.releaseBlockers.length > 0 ? releaseCandidateStabilization.releaseBlockers.map((blocker) => (
                <p key={blocker} className="empty-state">{blocker}</p>
              )) : <p className="empty-state">No release blockers detected.</p>}
            </section>
          </div>
          <div className="release-validation-summary">
            <MetricCard label="Event Pipeline" value={releaseCandidateStabilization.eventPipelineIntegrity.status} />
            <MetricCard label="Paper Safety Lock" value={releaseCandidateStabilization.checks.find((check) => check.name === 'paperTradingSafetyLock')?.status ?? 'unknown'} />
            <MetricCard label="Adapter Mock Mode" value={releaseCandidateStabilization.checks.find((check) => check.name === 'adapterMockMode')?.status ?? 'unknown'} />
            <MetricCard label="Event Output" value={releaseCandidateStabilization.eventType} />
          </div>
          <span className="event-line">{releaseCandidateStabilization.eventType}</span>
        </article>

        <article id="scanner-signal" className="panel scanner-signal-panel">
          <div className="panel-heading">
            <h2>Scanner / Signal Panel</h2>
            <span>Existing signal engine output from normalized paper market data.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{scannerSignal.quote.symbol} {scannerSignal.quote.assetType}</span>
              <strong>{scannerSignal.signal.action}</strong>
            </div>
            <span className="decision-pill positive">
              {formatPercent(scannerSignal.signal.confidence)} confidence
            </span>
          </div>
          <div className="scanner-signal-grid">
            <MetricCard label="Last Price" value={formatCurrency(scannerSignal.quote.price)} />
            <MetricCard label="Signal Score" value={formatNumber(scannerSignal.signal.score)} />
            <MetricCard label="Trend" value={scannerSignal.signal.trendDirection} />
            <MetricCard label="Momentum" value={formatNumber(scannerSignal.signal.momentum)} />
            <MetricCard label="Breakout" value={scannerSignal.signal.breakout} />
            <MetricCard label="Mean Reversion" value={scannerSignal.signal.meanReversion} />
            <MetricCard label="Bull Score" value={formatNumber(scannerSignal.signal.bullScore)} />
            <MetricCard label="Bear Score" value={formatNumber(scannerSignal.signal.bearScore)} />
          </div>
          <div className="scanner-match-list">
            {scannerSignal.matches.map((match) => (
              <section key={`${match.scanner}-${match.symbol}`} className="scanner-match-card">
                <div>
                  <span>{match.scanner}</span>
                  <strong>{match.symbol}</strong>
                </div>
                <p>{match.criteria.join(' / ')}</p>
                <span>{formatDate(match.evaluatedAt)}</span>
              </section>
            ))}
          </div>
          <p className="empty-state">{scannerSignal.signal.thesis}</p>
        </article>

        <article id="risk" className="panel risk-overview-panel">
          <div className="panel-heading">
            <h2>Risk Panel</h2>
            <span>Portfolio limits and current paper risk status.</span>
          </div>
          <div className="metric-grid">
            <MetricCard label="Risk Score" value={formatNumber(risk.summary.riskScore)} tone={riskTone} />
            <MetricCard label="Open Risk" value={formatCurrency(risk.summary.openRisk)} />
            <MetricCard label="Portfolio Heat" value={formatPercent(risk.summary.openRiskPct)} />
            <MetricCard label="Concentration" value={formatPercent(risk.summary.concentrationRisk)} />
            <MetricCard label="Liquidity" value={formatNumber(risk.summary.weightedLiquidityScore)} />
            <MetricCard label="Drawdown" value={formatPercent(risk.summary.drawdownPct)} />
          </div>
          <span className="event-line">{risk.eventType}</span>
        </article>

        <article id="guardrails" className="panel guardrail-panel">
          <div className="panel-heading">
            <h2>Trade Guardrails</h2>
            <span>Pre-lifecycle paper trade safety</span>
          </div>
          <div className="guardrail-grid">
            {guardrails.map(({ label, result }) => (
              <section key={result.proposedTrade.symbol + label} className={`guardrail-card ${result.approved ? 'approved' : 'rejected'}`}>
                <div className="guardrail-card-header">
                  <div>
                    <span>{label}</span>
                    <strong>{result.proposedTrade.symbol}</strong>
                  </div>
                  <span className={`decision-pill ${result.approved ? 'positive' : 'danger'}`}>
                    {result.decision}
                  </span>
                </div>
                <p>{result.reason}</p>
                <div className="guardrail-metrics">
                  <MetricCard label="Trade Risk" value={formatPercent(result.metrics.riskPct)} />
                  <MetricCard label="Portfolio Heat" value={formatPercent(result.metrics.portfolioHeatAfterTrade)} />
                  <MetricCard label="Required Capital" value={formatCurrency(result.metrics.marginRequirement)} />
                </div>
                <ul className="guardrail-checks">
                  {result.checks.map((check) => (
                    <li key={`${result.proposedTrade.symbol}-${check.name}`} className={check.passed ? 'positive' : 'danger'}>
                      {check.message}
                    </li>
                  ))}
                </ul>
                <span className="event-line">{result.eventType}</span>
              </section>
            ))}
          </div>
        </article>

        <article id="execution" className="panel execution-panel">
          <div className="panel-heading">
            <h2>Execution Simulation</h2>
            <span>Paper fills only. No live brokerage integration.</span>
          </div>
          <div className="execution-grid">
            {executions.map(({ label, result }) => (
              <section key={`${label}-${result.finalStatus}`} className={`execution-card ${result.finalStatus}`}>
                <div className="guardrail-card-header">
                  <div>
                    <span>{label}</span>
                    <strong>{result.proposedTrade?.symbol ?? 'N/A'}</strong>
                  </div>
                  <span className={`decision-pill ${result.finalStatus === 'filled' ? 'positive' : result.finalStatus === 'rejected' ? 'danger' : 'warning'}`}>
                    {result.finalStatus}
                  </span>
                </div>
                <p>{result.reason}</p>
                {result.fill ? (
                  <div className="execution-metrics">
                    <MetricCard label="Fill Price" value={formatCurrency(result.fill.fillPrice)} />
                    <MetricCard label="Slippage" value={`${formatNumber(result.fill.slippageBps)} bps`} />
                    <MetricCard label="Slippage $" value={formatCurrency(result.fill.slippageAmount)} />
                    <MetricCard label="Fees" value={formatCurrency(result.fill.fees)} />
                    <MetricCard label="Notional" value={formatCurrency(result.fill.notional)} />
                    <MetricCard label="Cash Impact" value={formatCurrency(result.fill.cashImpact)} />
                  </div>
                ) : (
                  <p className="empty-state">No simulated fill was created.</p>
                )}
                <span className="event-line">{result.eventType}</span>
              </section>
            ))}
          </div>
        </article>

        <article id="accounting" className="panel accounting-panel">
          <div className="panel-heading">
            <h2>Paper Accounting</h2>
            <span>Applies simulated fills to paper account state.</span>
          </div>
          <div className="accounting-grid">
            {accountingUpdates.map(({ label, result }) => (
              <section key={`${label}-${result.status}`} className={`accounting-card ${result.status === 'rejected' ? 'rejected' : 'updated'}`}>
                <div className="guardrail-card-header">
                  <div>
                    <span>{label}</span>
                    <strong>{result.status}</strong>
                  </div>
                  <span className={`decision-pill ${result.status === 'rejected' ? 'danger' : 'positive'}`}>
                    {result.executionStatus}
                  </span>
                </div>
                <p>{result.reason}</p>
                <div className="accounting-metrics">
                  <MetricCard label="Cash" value={formatCurrency(result.account.cash)} />
                  <MetricCard label="Equity" value={formatCurrency(result.account.equity)} />
                  <MetricCard label="Realized P&L" value={formatCurrency(result.account.realizedPnl)} />
                </div>
                <span className="event-line">{result.eventType}</span>
              </section>
            ))}
          </div>
          {primaryAccounting ? (
            <div className="table-wrap compact-table">
              <table>
                <caption>Updated paper positions after accounting</caption>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Asset</th>
                    <th>Side</th>
                    <th>Quantity</th>
                    <th>Average Price</th>
                    <th>Market Value</th>
                    <th>Unrealized P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {primaryAccounting.positions.map((position) => (
                    <tr key={`${position.symbol}-${position.assetType}-${position.side}`}>
                      <td><strong>{position.symbol}</strong></td>
                      <td>{position.assetType}</td>
                      <td>{position.side}</td>
                      <td>{formatNumber(position.quantity)} {position.quantityTerm}</td>
                      <td>{formatCurrency(position.averagePrice)}</td>
                      <td>{formatCurrency(position.marketValue)}</td>
                      <td className={position.unrealizedPnl >= 0 ? 'positive' : 'negative'}>{formatCurrency(position.unrealizedPnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article id="journal" className="panel journal-panel">
          <div className="panel-heading">
            <h2>Paper Trade Journal</h2>
            <span>Normalized lifecycle record from proposal through accounting.</span>
          </div>
          <div className="journal-grid">
            {journalRecords.map(({ label, result }) => (
              <section key={`${label}-${result.journalStatus}`} className={`journal-card ${result.journalStatus}`}>
                <div className="guardrail-card-header">
                  <div>
                    <span>{label}</span>
                    <strong>{result.symbol}</strong>
                  </div>
                  <span className={`decision-pill ${result.journalStatus === 'recorded' ? 'positive' : 'danger'}`}>
                    {result.journalStatus}
                  </span>
                </div>
                <div className="journal-metrics">
                  <MetricCard label="Side" value={result.side ?? 'N/A'} />
                  <MetricCard label="Quantity" value={formatNumber(result.quantity)} />
                  <MetricCard label="Fill" value={result.fill ? formatCurrency(result.fill.fillPrice) : 'N/A'} />
                  <MetricCard label="Realized P&L" value={formatCurrency(result.realizedPnl)} />
                  <MetricCard label="Decision Gate" value={result.decisionGate.guardrail} />
                  <MetricCard label="Accounting" value={result.decisionGate.accounting} />
                </div>
                <div className="event-chain">
                  {result.eventChain.map((event) => (
                    <span key={`${result.tradeId}-${event.eventType}`}>{event.eventType}</span>
                  ))}
                </div>
                <span className="event-line">{result.eventType}</span>
              </section>
            ))}
          </div>
        </article>

        <article id="performance" className="panel performance-panel">
          <div className="panel-heading">
            <h2>Paper Performance</h2>
            <span>Analytics from recorded filled journal records.</span>
          </div>
          <div className="performance-grid">
            <MetricCard label="Total Trades" value={formatNumber(performance.metrics.totalTrades)} />
            <MetricCard label="Win Rate" value={formatPercent(performance.metrics.winRate)} />
            <MetricCard label="Average Win" value={formatCurrency(performance.metrics.averageWin)} />
            <MetricCard label="Average Loss" value={formatCurrency(performance.metrics.averageLoss)} />
            <MetricCard label="Profit Factor" value={formatNumber(performance.metrics.profitFactor)} />
            <MetricCard label="Net Realized P&L" value={formatCurrency(performance.metrics.netRealizedPnl)} />
            <MetricCard label="Largest Win" value={formatCurrency(performance.metrics.largestWin)} />
            <MetricCard label="Largest Loss" value={formatCurrency(performance.metrics.largestLoss)} />
            <MetricCard label="Expectancy" value={formatCurrency(performance.metrics.expectancy)} />
            <MetricCard label="Excluded Trades" value={formatNumber(performance.excludedTrades)} />
          </div>
          <p className="empty-state">{performance.excludedReason}</p>
          <span className="event-line">{performance.eventType}</span>
        </article>

        <article id="risk-adjusted-performance" className="panel risk-adjusted-performance-panel">
          <div className="panel-heading">
            <h2>Risk-Adjusted Performance</h2>
            <span>Quality of paper returns after rejected and non-filled trades are excluded.</span>
          </div>
          <div className="risk-adjusted-summary">
            <MetricCard label="Grade" value={riskAdjustedPerformance.metrics.riskAdjustedGrade} />
            <MetricCard label="Sharpe-style Score" value={formatNumber(riskAdjustedPerformance.metrics.sharpeStyleScore)} />
            <MetricCard label="Sortino-style Score" value={formatNumber(riskAdjustedPerformance.metrics.sortinoStyleDownsideScore)} />
            <MetricCard label="Volatility Estimate" value={formatPercent(riskAdjustedPerformance.metrics.volatilityEstimate)} />
            <MetricCard label="Max Drawdown" value={formatPercent(riskAdjustedPerformance.metrics.maxDrawdown)} />
            <MetricCard label="Average Drawdown" value={formatPercent(riskAdjustedPerformance.metrics.averageDrawdown)} />
            <MetricCard label="Recovery Factor" value={formatNumber(riskAdjustedPerformance.metrics.recoveryFactor)} />
            <MetricCard label="Return Observations" value={formatNumber(riskAdjustedPerformance.returnSeries.length)} />
          </div>
          {riskAdjustedPerformance.returnSeries.length > 0 ? (
            <div className="return-series">
              {riskAdjustedPerformance.returnSeries.map((point) => (
                <div key={point.tradeId} className="return-row">
                  <span>{point.symbol}</span>
                  <strong className={point.returnPct >= 0 ? 'positive' : 'negative'}>{formatPercent(point.returnPct)}</strong>
                  <span>{formatCurrency(point.endingEquity)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No filled paper trade returns are available for risk-adjusted scoring.</p>
          )}
          <p className="empty-state">{riskAdjustedPerformance.excludedReason}</p>
          <span className="event-line">{riskAdjustedPerformance.eventType}</span>
        </article>

        <article id="drawdown-protection" className={`panel drawdown-protection-panel ${drawdownProtection.protectionStatus}`}>
          <div className="panel-heading">
            <h2>Drawdown Protection</h2>
            <span>Paper risk protection before new trades are allowed.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Protection Status</span>
              <strong>{drawdownProtection.protectionStatus}</strong>
            </div>
            <span className={`decision-pill ${drawdownProtection.protectionStatus === 'locked' ? 'danger' : drawdownProtection.protectionStatus === 'caution' ? 'warning' : 'positive'}`}>
              {drawdownProtection.recommendedAction}
            </span>
          </div>
          <div className="drawdown-grid">
            <MetricCard label="Current Drawdown" value={formatPercent(drawdownProtection.currentDrawdown)} />
            <MetricCard label="Max Threshold" value={formatPercent(drawdownProtection.maxDrawdownThreshold)} />
            <MetricCard label="Daily Loss" value={`${formatCurrency(drawdownProtection.dailyLoss.amount)} / ${formatPercent(drawdownProtection.dailyLoss.pct)}`} />
            <MetricCard label="Daily Threshold" value={formatPercent(drawdownProtection.dailyLossThreshold)} />
            <MetricCard label="Weekly Loss" value={`${formatCurrency(drawdownProtection.weeklyLoss.amount)} / ${formatPercent(drawdownProtection.weeklyLoss.pct)}`} />
            <MetricCard label="Weekly Threshold" value={formatPercent(drawdownProtection.weeklyLossThreshold)} />
            <MetricCard label="Equity Peak" value={formatCurrency(drawdownProtection.equityPeak)} />
            <MetricCard label="Current Equity" value={formatCurrency(drawdownProtection.currentEquity)} />
          </div>
          {drawdownProtection.warnings.length > 0 ? (
            <ul className="warning-list">
              {drawdownProtection.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : (
            <p className="empty-state">Drawdown protection is clear for paper trading review.</p>
          )}
          <span className="event-line">{drawdownProtection.eventType}</span>
        </article>

        <article id="position-sizing" className={`panel position-sizing-panel ${positionSizing.status}`}>
          <div className="panel-heading">
            <h2>Position Sizing</h2>
            <span>Paper-only sizing recommendation before guardrail and execution.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{positionSizing.proposedTrade.symbol}</span>
              <strong>{formatNumber(positionSizing.suggestedQuantity)} {positionSizing.quantityTerm}</strong>
            </div>
            <span className={`decision-pill ${positionSizing.status === 'recommended' ? 'positive' : 'danger'}`}>
              {positionSizing.status}
            </span>
          </div>
          <p className="empty-state">{positionSizing.reason}</p>
          <div className="position-sizing-grid">
            <MetricCard label="Dollar Risk" value={formatCurrency(positionSizing.metrics.dollarRisk)} />
            <MetricCard label="Risk %" value={formatPercent(positionSizing.metrics.riskPct)} />
            <MetricCard label="Stop Distance" value={formatCurrency(positionSizing.metrics.stopDistance)} />
            <MetricCard label="Target Risk" value={formatCurrency(positionSizing.metrics.targetRiskAmount)} />
            <MetricCard label="Max Position Cap" value={`${formatNumber(positionSizing.sizing.maxPositionValueQuantity)} ${positionSizing.quantityTerm}`} />
            <MetricCard label="Buying Power Cap" value={`${formatNumber(positionSizing.sizing.buyingPowerQuantity)} ${positionSizing.quantityTerm}`} />
            <MetricCard label="Drawdown Status" value={positionSizing.constraints.drawdownProtectionStatus} />
            <MetricCard label="Guardrail" value={positionSizing.constraints.guardrailDecision} />
          </div>
          {positionSizing.errors.length > 0 ? (
            <ul className="warning-list">
              {positionSizing.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          ) : null}
          <span className="event-line">{positionSizing.eventType}</span>
        </article>

        <article id="capital-allocation" className={`panel capital-allocation-panel ${capitalAllocation.allocationStatus}`}>
          <div className="panel-heading">
            <h2>Capital Allocation</h2>
            <span>Paper capital recommendations by strategy, asset class, and symbol.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Allocation Status</span>
              <strong>{capitalAllocation.allocationStatus}</strong>
            </div>
            <span className={`decision-pill ${capitalAllocation.allocationStatus === 'balanced' ? 'positive' : capitalAllocation.allocationStatus === 'caution' ? 'warning' : 'danger'}`}>
              recommendations only
            </span>
          </div>
          <div className="capital-grid">
            <MetricCard label="Available Capital" value={formatCurrency(capitalAllocation.capital.availableCapital)} />
            <MetricCard label="Reserved Cash" value={formatCurrency(capitalAllocation.capital.reservedCashBuffer)} />
            <MetricCard label="Risk Budget" value={formatCurrency(capitalAllocation.capital.totalRiskBudget)} />
            <MetricCard label="Remaining Risk Budget" value={formatCurrency(capitalAllocation.capital.remainingRiskBudget)} />
          </div>
          <div className="capital-columns">
            <section>
              <h3>Strategy Allocation</h3>
              {capitalAllocation.allocation.byStrategy.map((item) => (
                <div key={item.strategy} className="mini-row">
                  <span>{item.strategy}</span>
                  <strong>{formatCurrency(item.recommendedCapital)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Asset Class Drift</h3>
              {capitalAllocation.allocation.byAssetClass.slice(0, 4).map((item) => (
                <div key={item.assetType} className="mini-row">
                  <span>{item.assetType} {item.allocationState}</span>
                  <strong>{formatPercent(item.driftPct)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Symbol Allocation</h3>
              {capitalAllocation.allocation.bySymbol.slice(0, 4).map((item) => (
                <div key={`${item.symbol}-${item.side}`} className="mini-row">
                  <span>{item.symbol} {item.allocationState}</span>
                  <strong>{formatPercent(item.currentWeight)}</strong>
                </div>
              ))}
            </section>
          </div>
          <ul className="warning-list">
            {capitalAllocation.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
          </ul>
          <span className="event-line">{capitalAllocation.eventType}</span>
        </article>

        <article id="ai-decision" className={`panel ai-decision-panel ${aiDecision.finalDecision}`}>
          <div className="panel-heading">
            <h2>AI Decision Orchestrator</h2>
            <span>Final paper decision from signals, risk, sizing, allocation, protection, and performance.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{aiDecision.decisionInput.symbol}</span>
              <strong>{aiDecision.finalDecision}</strong>
            </div>
            <span className={`decision-pill ${aiDecision.finalDecision === 'approve' ? 'positive' : aiDecision.finalDecision === 'reject' ? 'danger' : 'warning'}`}>
              {formatPercent(aiDecision.confidenceScore)} confidence
            </span>
          </div>
          <p className="empty-state">{aiDecision.rationale}</p>
          <div className="ai-decision-grid">
            <MetricCard label="Signal Quality" value={`${formatNumber(aiDecision.signalQuality.score)} ${aiDecision.signalQuality.label}`} />
            <MetricCard label="Risk Approval" value={aiDecision.riskApprovalSummary.guardrailDecision} />
            <MetricCard label="Position Size" value={`${formatNumber(aiDecision.positionSizingSummary.suggestedQuantity)} ${aiDecision.positionSizingSummary.quantityTerm}`} />
            <MetricCard label="Capital Allocation" value={aiDecision.capitalAllocationSummary.allocationStatus} />
            <MetricCard label="Drawdown" value={aiDecision.drawdownProtectionSummary.protectionStatus} />
            <MetricCard label="Performance Score" value={formatNumber(aiDecision.performanceContext.score)} />
          </div>
          {aiDecision.blockers.length > 0 || aiDecision.cautions.length > 0 ? (
            <ul className="warning-list">
              {[...aiDecision.blockers, ...aiDecision.cautions].map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <p className="empty-state">No AI orchestration blockers detected for this paper decision.</p>
          )}
          <span className="event-line">{aiDecision.eventType}</span>
        </article>

        <article id="strategy-builder" className={`panel strategy-builder-panel ${strategyBlueprintValidation.validationStatus}`}>
          <div className="panel-heading">
            <h2>Strategy Builder</h2>
            <span>Paper-only reusable strategy blueprint foundation.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyBlueprintValidation.blueprint.version}</span>
              <strong>{strategyBlueprintValidation.blueprint.name}</strong>
            </div>
            <span className={`decision-pill ${strategyBlueprintValidation.validationStatus === 'valid' ? 'positive' : strategyBlueprintValidation.validationStatus === 'caution' ? 'warning' : 'danger'}`}>
              {strategyBlueprintValidation.validationStatus}
            </span>
          </div>
          <p className="empty-state">{strategyBlueprintValidation.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Entry Conditions" value={formatNumber(strategyBlueprintValidation.blueprint.entryConditions.length)} />
            <MetricCard label="Exit Conditions" value={formatNumber(strategyBlueprintValidation.blueprint.exitConditions.length)} />
            <MetricCard label="Risk References" value={formatNumber(strategyBlueprintValidation.blueprint.riskRuleReferences.length)} />
            <MetricCard label="Timeframes" value={strategyBlueprintValidation.blueprint.timeframeReferences.join(' / ')} />
            <MetricCard label="Asset Classes" value={strategyBlueprintValidation.blueprint.compatibleAssetClasses.join(' / ')} />
            <MetricCard label="Paper Mode" value={strategyBlueprintValidation.paperTrading ? 'enabled' : 'disabled'} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Metadata</span>
                <strong>{strategyBlueprintValidation.blueprint.metadata.owner}</strong>
              </div>
              <p>{strategyBlueprintValidation.blueprint.metadata.description}</p>
            </section>
            <section>
              <div>
                <span>References</span>
                <strong>{strategyBlueprintValidation.blueprint.references.aiDecisionEvent}</strong>
              </div>
              <p>{strategyBlueprintValidation.blueprint.references.marketRegimeEvent} / {strategyBlueprintValidation.blueprint.references.portfolioRiskEvent}</p>
            </section>
            <section>
              <div>
                <span>Validation</span>
                <strong>{strategyBlueprintValidation.validationStatus}</strong>
              </div>
              <p>{[...strategyBlueprintValidation.blockers, ...strategyBlueprintValidation.cautions].join('; ') || 'Blueprint is ready for paper strategy reuse.'}</p>
            </section>
          </div>
          <span className="event-line">{strategyBlueprintValidation.eventType}</span>
        </article>

        <article id="strategy-rule-evaluation" className={`panel strategy-rule-evaluation-panel ${strategyRuleEvaluation.strategyEvaluationStatus}`}>
          <div className="panel-heading">
            <h2>Strategy Rule Evaluation</h2>
            <span>Paper-only rule checks against normalized market, research, and risk context.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyRuleEvaluation.strategyName}</span>
              <strong>{strategyRuleEvaluation.strategyEvaluationStatus}</strong>
            </div>
            <span className={`decision-pill ${strategyRuleEvaluation.strategyEvaluationStatus === 'eligible' ? 'positive' : strategyRuleEvaluation.strategyEvaluationStatus === 'blocked' ? 'danger' : 'warning'}`}>
              {strategyRuleEvaluation.symbol} / {strategyRuleEvaluation.timeframe}
            </span>
          </div>
          <p className="empty-state">{strategyRuleEvaluation.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Entry Rules" value={`${strategyRuleEvaluation.entryRuleEvaluation.passed}/${strategyRuleEvaluation.entryRuleEvaluation.total} ${strategyRuleEvaluation.entryRuleEvaluation.status}`} />
            <MetricCard label="Exit Rules" value={`${strategyRuleEvaluation.exitRuleEvaluation.passed}/${strategyRuleEvaluation.exitRuleEvaluation.total} ${strategyRuleEvaluation.exitRuleEvaluation.status}`} />
            <MetricCard label="Risk Rules" value={`${strategyRuleEvaluation.riskRuleEvaluation.passed}/${strategyRuleEvaluation.riskRuleEvaluation.total} ${strategyRuleEvaluation.riskRuleEvaluation.status}`} />
            <MetricCard label="Timeframe Compatibility" value={strategyRuleEvaluation.timeframeCompatibility.status} />
            <MetricCard label="Asset Compatibility" value={strategyRuleEvaluation.assetClassCompatibility.status} />
            <MetricCard label="Paper Mode" value={strategyRuleEvaluation.paperTrading ? 'enabled' : 'disabled'} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Entry Rule Detail</span>
                <strong>{strategyRuleEvaluation.entryRuleEvaluation.status}</strong>
              </div>
              <p>{strategyRuleEvaluation.entryRuleEvaluation.rules.map((rule) => `${rule.id}: ${rule.status}`).join('; ')}</p>
            </section>
            <section>
              <div>
                <span>Exit Rule Detail</span>
                <strong>{strategyRuleEvaluation.exitRuleEvaluation.status}</strong>
              </div>
              <p>{strategyRuleEvaluation.exitRuleEvaluation.rules.map((rule) => `${rule.id}: ${rule.status}`).join('; ')}</p>
            </section>
            <section>
              <div>
                <span>Evaluation Notes</span>
                <strong>{strategyRuleEvaluation.blockers.length > 0 ? 'blocked' : strategyRuleEvaluation.cautions.length > 0 ? 'review' : 'clear'}</strong>
              </div>
              <p>{[...strategyRuleEvaluation.blockers, ...strategyRuleEvaluation.cautions].join('; ') || 'Strategy rules are eligible for paper-trading review.'}</p>
            </section>
          </div>
          <span className="event-line">{strategyRuleEvaluation.eventType}</span>
        </article>

        <article id="strategy-signal-composer" className={`panel strategy-signal-composer-panel ${strategySignalComposition.signalStatus}`}>
          <div className="panel-heading">
            <h2>Strategy Signal Composer</h2>
            <span>Paper-only normalized strategy signal for downstream AI and trade lifecycle context.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategySignalComposition.normalizedStrategySignal.strategyName}</span>
              <strong>{strategySignalComposition.normalizedStrategySignal.signalAction} / {strategySignalComposition.normalizedStrategySignal.signalDirection}</strong>
            </div>
            <span className={`decision-pill ${strategySignalComposition.signalStatus === 'composed' ? 'positive' : 'warning'}`}>
              {strategySignalComposition.signalStatus}
            </span>
          </div>
          <p className="empty-state">{strategySignalComposition.rationaleSummary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Signal Direction" value={strategySignalComposition.signalDirection} />
            <MetricCard label="Signal Strength" value={formatNumber(strategySignalComposition.signalStrengthScore)} />
            <MetricCard label="Confidence Score" value={formatNumber(strategySignalComposition.confidenceScore)} />
            <MetricCard label="Entry Signal" value={strategySignalComposition.entrySignalComposition.active ? 'active' : 'inactive'} />
            <MetricCard label="Exit Signal" value={strategySignalComposition.exitSignalComposition.active ? 'active' : 'inactive'} />
            <MetricCard label="Source Rules" value={formatNumber(strategySignalComposition.sourceRuleReferences.length)} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Normalized Signal</span>
                <strong>{strategySignalComposition.normalizedStrategySignal.symbol} / {strategySignalComposition.normalizedStrategySignal.assetType}</strong>
              </div>
              <p>{strategySignalComposition.normalizedStrategySignal.rationaleSummary}</p>
            </section>
            <section>
              <div>
                <span>Source Rule References</span>
                <strong>{strategySignalComposition.sourceRuleReferences.length}</strong>
              </div>
              <p>{strategySignalComposition.sourceRuleReferences.map((rule) => `${rule.id}: ${rule.status}`).join('; ') || 'No active source rules because strategy signal is suppressed.'}</p>
            </section>
            <section>
              <div>
                <span>AI Decision Compatibility</span>
                <strong>{strategySignalComposition.normalizedStrategySignal.compatibleWithAIDecisionOrchestrator ? 'compatible' : 'suppressed'}</strong>
              </div>
              <p>{strategySignalComposition.summary}</p>
            </section>
          </div>
          <span className="event-line">{strategySignalComposition.eventType}</span>
        </article>

        <article id="strategy-lifecycle" className={`panel strategy-lifecycle-panel ${strategyLifecycle.lifecycleState}`}>
          <div className="panel-heading">
            <h2>Strategy Lifecycle</h2>
            <span>Paper-only lifecycle state from blueprint validation through active strategy readiness.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyLifecycle.strategyName}</span>
              <strong>{strategyLifecycle.lifecycleState}</strong>
            </div>
            <span className={`decision-pill ${strategyLifecycle.activationEligibility.status === 'eligible' ? 'positive' : strategyLifecycle.activationEligibility.status === 'blocked' ? 'danger' : 'warning'}`}>
              {strategyLifecycle.activationEligibility.status}
            </span>
          </div>
          <p className="empty-state">{strategyLifecycle.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Lifecycle State" value={strategyLifecycle.lifecycleState} />
            <MetricCard label="Activation Eligibility" value={strategyLifecycle.activationEligibility.status} />
            <MetricCard label="Pause Recommendation" value={strategyLifecycle.pauseRecommendation.recommended ? 'recommended' : 'none'} />
            <MetricCard label="Archive Recommendation" value={strategyLifecycle.archiveRecommendation.recommended ? 'recommended' : 'none'} />
            <MetricCard label="Validation Snapshot" value={strategyLifecycle.validationSnapshot.validationStatus} />
            <MetricCard label="Signal Snapshot" value={strategyLifecycle.signalComposerSnapshot.signalStatus} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Lifecycle Audit Event</span>
                <strong>{strategyLifecycle.lifecycleAuditEvent.transition}</strong>
              </div>
              <p>{strategyLifecycle.lifecycleAuditEvent.reasons.join('; ') || 'Lifecycle state unchanged without activation blockers.'}</p>
            </section>
            <section>
              <div>
                <span>Research And Regime Snapshot</span>
                <strong>{strategyLifecycle.researchRegimeContextSnapshot.research.decisionBias}</strong>
              </div>
              <p>{strategyLifecycle.researchRegimeContextSnapshot.marketRegime.compositeRegimeLabel} / {strategyLifecycle.researchRegimeContextSnapshot.aiDecision.finalDecision}</p>
            </section>
            <section>
              <div>
                <span>Recommendations</span>
                <strong>{strategyLifecycle.pauseRecommendation.recommended || strategyLifecycle.archiveRecommendation.recommended ? 'review' : 'clear'}</strong>
              </div>
              <p>{[strategyLifecycle.pauseRecommendation.summary, strategyLifecycle.archiveRecommendation.summary].join(' ')}</p>
            </section>
          </div>
          <span className="event-line">{strategyLifecycle.eventType}</span>
        </article>

        <article id="strategy-registry" className="panel strategy-registry-panel active">
          <div className="panel-heading">
            <h2>Strategy Registry</h2>
            <span>Paper-only strategy library for validated blueprint reuse across Atlas.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyRegistry.registryRecord.strategyName}</span>
              <strong>{strategyRegistry.registryRecord.status}</strong>
            </div>
            <span className="decision-pill positive">
              {strategyRegistry.registryRecord.versionReference}
            </span>
          </div>
          <p className="empty-state">{strategyRegistry.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Library Strategies" value={formatNumber(strategyRegistry.strategyLibraryCollection.totalStrategies)} />
            <MetricCard label="Active Strategies" value={formatNumber(strategyRegistry.activeStrategyCount)} />
            <MetricCard label="Status Filter" value={strategyRegistry.strategyLibraryCollection.filters.status ?? 'all'} />
            <MetricCard label="Asset-Class Filter" value={strategyRegistry.strategyLibraryCollection.filters.assetClass ?? 'all'} />
            <MetricCard label="Timeframe Filter" value={strategyRegistry.strategyLibraryCollection.filters.timeframe ?? 'all'} />
            <MetricCard label="Strategy Tags" value={strategyRegistry.registryRecord.tags.join(' / ') || 'none'} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Normalized Registry Record</span>
                <strong>{strategyRegistry.registryRecord.strategyId}</strong>
              </div>
              <p>{strategyRegistry.registryRecord.strategyName} / {strategyRegistry.registryRecord.versionReference} / {strategyRegistry.registryRecord.lifecycleState}</p>
            </section>
            <section>
              <div>
                <span>Active Strategy Lookup</span>
                <strong>{Object.keys(strategyRegistry.activeStrategyLookup).length}</strong>
              </div>
              <p>{Object.keys(strategyRegistry.activeStrategyLookup).join('; ') || 'No active paper strategies registered.'}</p>
            </section>
            <section>
              <div>
                <span>Strategy Library Collection</span>
                <strong>{Object.entries(strategyRegistry.strategyLibraryCollection.statusCounts).map(([status, count]) => `${status}: ${count}`).join(' / ')}</strong>
              </div>
              <p>{strategyRegistry.strategyLibraryCollection.records.map((record) => `${record.strategyName}: ${record.status}`).join('; ')}</p>
            </section>
          </div>
          <span className="event-line">{strategyRegistry.eventType}</span>
        </article>

        <article id="strategy-backtest-input" className={`panel strategy-backtest-input-panel ${strategyBacktestInput.readinessStatus}`}>
          <div className="panel-heading">
            <h2>Backtest Input Builder</h2>
            <span>Paper-only input preparation for future backtesting. No backtest execution.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyBacktestInput.selectedStrategySnapshot.strategyName}</span>
              <strong>{strategyBacktestInput.readinessStatus}</strong>
            </div>
            <span className={`decision-pill ${strategyBacktestInput.readinessStatus === 'ready' ? 'positive' : strategyBacktestInput.readinessStatus === 'blocked' ? 'danger' : 'warning'}`}>
              {strategyBacktestInput.selectedStrategySnapshot.versionReference}
            </span>
          </div>
          <p className="empty-state">{strategyBacktestInput.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Readiness Status" value={strategyBacktestInput.readinessStatus} />
            <MetricCard label="Selected Strategy" value={strategyBacktestInput.selectedStrategySnapshot.strategyId} />
            <MetricCard label="Selected Asset Universe" value={strategyBacktestInput.selectedAssetUniverse.map((asset) => `${asset.symbol} ${asset.assetType}`).join(' / ')} />
            <MetricCard label="Timeframe Selection" value={strategyBacktestInput.timeframeSelection.timeframe} />
            <MetricCard label="Initial Capital" value={formatCurrency(strategyBacktestInput.initialCapitalConfiguration.initialCapital)} />
            <MetricCard label="Adapter Compatibility" value={strategyBacktestInput.marketDataAdapterCompatibilityCheck.compatible ? 'compatible' : 'blocked'} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Normalized Backtest Request</span>
                <strong>{strategyBacktestInput.normalizedBacktestRequest.requestId}</strong>
              </div>
              <p>{strategyBacktestInput.dateRangeValidation.startDate} to {strategyBacktestInput.dateRangeValidation.endDate} / {formatNumber(strategyBacktestInput.dateRangeValidation.lookbackDays)} days</p>
            </section>
            <section>
              <div>
                <span>Risk Configuration Snapshot</span>
                <strong>{strategyBacktestInput.riskConfigurationSnapshot.portfolioRisk.riskLevel}</strong>
              </div>
              <p>{strategyBacktestInput.riskConfigurationSnapshot.positionSizing.status} sizing / {strategyBacktestInput.riskConfigurationSnapshot.capitalAllocation.allocationStatus} allocation</p>
            </section>
            <section>
              <div>
                <span>Readiness Notes</span>
                <strong>{strategyBacktestInput.blockers.length > 0 ? 'blocked' : strategyBacktestInput.cautions.length > 0 ? 'review' : 'clear'}</strong>
              </div>
              <p>{[...strategyBacktestInput.blockers, ...strategyBacktestInput.cautions].join('; ') || 'Backtest input is ready for future paper backtest engine intake.'}</p>
            </section>
          </div>
          <span className="event-line">{strategyBacktestInput.eventType}</span>
        </article>

        <article id="historical-replay" className={`panel historical-replay-panel ${historicalReplay.replayStepOutput.status}`}>
          <div className="panel-heading">
            <h2>Historical Replay</h2>
            <span>Paper-only historical market replay foundation for future backtesting.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{historicalReplay.replaySessionConfiguration.sessionId}</span>
              <strong>{historicalReplay.replayStepOutput.status}</strong>
            </div>
            <span className={`decision-pill ${historicalReplay.replayStepOutput.status === 'ready' ? 'positive' : historicalReplay.replayStepOutput.status === 'blocked' ? 'danger' : 'warning'}`}>
              {historicalReplay.replaySessionConfiguration.symbol} / {historicalReplay.replaySessionConfiguration.interval}
            </span>
          </div>
          <p className="empty-state">{historicalReplay.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Replay Cursor" value={`${formatNumber(historicalReplay.replayCursorState.cursorIndex + 1)} / ${formatNumber(historicalReplay.replayCursorState.totalCandles)}`} />
            <MetricCard label="Current Candle" value={historicalReplay.replayStepOutput.candle?.timestamp ?? 'none'} />
            <MetricCard label="Timeframe Compatibility" value={historicalReplay.timeframeCompatibilityValidation.status} />
            <MetricCard label="Missing Data" value={historicalReplay.missingDataDetection.hasMissingData ? 'detected' : 'clear'} />
            <MetricCard label="Stale Candles" value={formatNumber(historicalReplay.staleIncompleteCandleDetection.staleCount)} />
            <MetricCard label="Incomplete Candles" value={formatNumber(historicalReplay.staleIncompleteCandleDetection.incompleteCount)} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Replay Session Configuration</span>
                <strong>{historicalReplay.replaySessionConfiguration.timeframe}</strong>
              </div>
              <p>{historicalReplay.replaySessionConfiguration.dateRange.startDate} to {historicalReplay.replaySessionConfiguration.dateRange.endDate}</p>
            </section>
            <section>
              <div>
                <span>Replay Step Output</span>
                <strong>{historicalReplay.replayStepOutput.candle?.close ?? 'none'}</strong>
              </div>
              <p>Previous: {historicalReplay.replayStepOutput.previousCandle?.close ?? 'none'} / Next: {historicalReplay.replayStepOutput.nextTimestamp ?? 'complete'}</p>
            </section>
            <section>
              <div>
                <span>Data Quality</span>
                <strong>{historicalReplay.missingDataDetection.missingCount}</strong>
              </div>
              <p>{historicalReplay.missingDataDetection.gaps.map((gap) => `${gap.after} to ${gap.before}`).join('; ') || 'Historical candles are contiguous for replay preparation.'}</p>
            </section>
          </div>
          <span className="event-line">{historicalReplay.eventType}</span>
        </article>

        <article id="strategy-backtest-execution" className={`panel strategy-backtest-execution-panel ${strategyBacktestExecution.backtestExecutionStatus}`}>
          <div className="panel-heading">
            <h2>Backtest Execution</h2>
            <span>Paper-only strategy signal replay through historical candles. No live orders.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyBacktestExecution.session.sessionId}</span>
              <strong>{strategyBacktestExecution.backtestExecutionStatus}</strong>
            </div>
            <span className={`decision-pill ${strategyBacktestExecution.backtestExecutionStatus === 'completed' ? 'positive' : strategyBacktestExecution.backtestExecutionStatus === 'blocked' ? 'danger' : 'warning'}`}>
              {strategyBacktestExecution.session.symbol} / {strategyBacktestExecution.session.timeframe}
            </span>
          </div>
          <p className="empty-state">{strategyBacktestExecution.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Replay Steps Consumed" value={`${formatNumber(strategyBacktestExecution.session.consumedCandles ?? 0)} / ${formatNumber(strategyBacktestExecution.session.totalCandles ?? 0)}`} />
            <MetricCard label="Rule Evaluations" value={formatNumber(strategyBacktestExecution.strategyRuleEvaluations.length)} />
            <MetricCard label="Signal Compositions" value={formatNumber(strategyBacktestExecution.strategySignalCompositions.length)} />
            <MetricCard label="Simulated Paper Trades" value={formatNumber(strategyBacktestExecution.executionSummary?.generatedTrades ?? 0)} />
            <MetricCard label="Filled Trades" value={formatNumber(strategyBacktestExecution.executionSummary?.filledTrades ?? 0)} />
            <MetricCard label="Final Equity" value={formatCurrency(strategyBacktestExecution.executionSummary?.finalEquity ?? 0)} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Replay Step Consumption</span>
                <strong>{strategyBacktestExecution.replayStepConsumption.length}</strong>
              </div>
              <p>{strategyBacktestExecution.replayStepConsumption.map((step) => `${step.timestamp}: ${step.action}`).join('; ') || strategyBacktestExecution.reason}</p>
            </section>
            <section>
              <div>
                <span>Simulated Trade Lifecycle</span>
                <strong>{strategyBacktestExecution.simulatedPaperTrades.length}</strong>
              </div>
              <p>{strategyBacktestExecution.simulatedPaperTrades.map((trade) => `${trade.proposedTrade.id}: ${trade.executionSimulation.finalStatus}`).join('; ') || 'No paper trades generated from replay signals.'}</p>
            </section>
            <section>
              <div>
                <span>Guardrail And Sizing References</span>
                <strong>{strategyBacktestExecution.guardrailAndPositionSizingSnapshotReferences?.positionSizing ?? 'none'}</strong>
              </div>
              <p>{strategyBacktestExecution.guardrailAndPositionSizingSnapshotReferences?.guardrail ?? 'No guardrail reference'} / {strategyBacktestExecution.guardrailAndPositionSizingSnapshotReferences?.portfolioRisk ?? 'No risk reference'}</p>
            </section>
          </div>
          <span className="event-line">{strategyBacktestExecution.eventType}</span>
        </article>

        <article id="strategy-backtest-performance" className={`panel strategy-backtest-performance-panel ${strategyBacktestPerformance.analyticsStatus}`}>
          <div className="panel-heading">
            <h2>Backtest Performance</h2>
            <span>Paper-only analytics over completed strategy backtest results.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyBacktestExecution.session.sessionId}</span>
              <strong>{strategyBacktestPerformance.analyticsStatus}</strong>
            </div>
            <span className={`decision-pill ${strategyBacktestPerformance.analyticsStatus === 'evaluated' ? 'positive' : strategyBacktestPerformance.analyticsStatus === 'blocked' ? 'danger' : 'warning'}`}>
              {strategyBacktestPerformance.backtestExecutionStatus}
            </span>
          </div>
          <p className="empty-state">{strategyBacktestPerformance.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Total Simulated Trades" value={formatNumber(strategyBacktestPerformance.metrics.totalSimulatedTrades)} />
            <MetricCard label="Win Rate" value={formatPercent(strategyBacktestPerformance.metrics.winRate)} />
            <MetricCard label="Net Realized P&L" value={formatCurrency(strategyBacktestPerformance.metrics.netRealizedPnl)} />
            <MetricCard label="Average Win" value={formatCurrency(strategyBacktestPerformance.metrics.averageWin)} />
            <MetricCard label="Average Loss" value={formatCurrency(strategyBacktestPerformance.metrics.averageLoss)} />
            <MetricCard label="Profit Factor" value={formatNumber(strategyBacktestPerformance.metrics.profitFactor)} />
            <MetricCard label="Expectancy" value={formatCurrency(strategyBacktestPerformance.metrics.expectancy)} />
            <MetricCard label="Max Drawdown" value={formatPercent(strategyBacktestPerformance.metrics.maxDrawdown)} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Return Curve Summary</span>
                <strong>{formatCurrency(strategyBacktestPerformance.returnCurveSummary.endingEquity)}</strong>
              </div>
              <p>{formatPercent(strategyBacktestPerformance.returnCurveSummary.totalReturnPct)} total return across {formatNumber(strategyBacktestPerformance.returnCurveSummary.points.length)} included trades.</p>
            </section>
            <section>
              <div>
                <span>Rejected / Non-Filled Exclusion</span>
                <strong>{formatNumber(strategyBacktestPerformance.excludedTrades)}</strong>
              </div>
              <p>{strategyBacktestPerformance.excludedReason ?? 'Rejected and non-filled paper trades are excluded from performance metrics.'}</p>
            </section>
            <section>
              <div>
                <span>Included Trade IDs</span>
                <strong>{formatNumber(strategyBacktestPerformance.includedTrades)}</strong>
              </div>
              <p>{strategyBacktestPerformance.paperPerformanceSnapshot?.includedTradeIds?.join('; ') || 'No included completed paper trades yet.'}</p>
            </section>
          </div>
          <span className="event-line">{strategyBacktestPerformance.eventType}</span>
        </article>

        <article id="strategy-walk-forward" className={`panel strategy-walk-forward-panel ${strategyWalkForward.finalWalkForwardStatus}`}>
          <div className="panel-heading">
            <h2>Walk-Forward Testing</h2>
            <span>Paper-only robustness evaluation across sequential historical windows.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyBacktestExecution.session.sessionId}</span>
              <strong>{strategyWalkForward.finalWalkForwardStatus}</strong>
            </div>
            <span className={`decision-pill ${strategyWalkForward.finalWalkForwardStatus === 'robust' ? 'positive' : strategyWalkForward.finalWalkForwardStatus === 'failed' ? 'danger' : 'warning'}`}>
              {formatNumber(strategyWalkForward.robustnessScore)} robustness
            </span>
          </div>
          <p className="empty-state">{strategyWalkForward.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="In-Sample Window" value={`${formatNumber(strategyWalkForward.inSampleWindowConfiguration.size)} candles`} />
            <MetricCard label="Out-of-Sample Window" value={`${formatNumber(strategyWalkForward.outOfSampleWindowConfiguration.size)} candles`} />
            <MetricCard label="Rolling Windows" value={formatNumber(strategyWalkForward.rollingWindows.length)} />
            <MetricCard label="Robustness Score" value={formatNumber(strategyWalkForward.robustnessScore)} />
            <MetricCard label="Degradation Detection" value={strategyWalkForward.degradationDetection.degraded ? 'detected' : 'clear'} />
            <MetricCard label="Walk-Forward Status" value={strategyWalkForward.finalWalkForwardStatus} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Per-Window Backtest Execution</span>
                <strong>{formatNumber(strategyWalkForward.perWindowBacktestExecutionReferences.length)}</strong>
              </div>
              <p>{strategyWalkForward.perWindowBacktestExecutionReferences.map((item) => `${item.windowId}: ${item.status}`).join('; ') || 'No walk-forward execution windows generated.'}</p>
            </section>
            <section>
              <div>
                <span>Per-Window Performance Summary</span>
                <strong>{formatNumber(strategyWalkForward.perWindowPerformanceSummary.length)}</strong>
              </div>
              <p>{strategyWalkForward.perWindowPerformanceSummary.map((item) => `${item.windowId}: ${formatCurrency(item.netRealizedPnl)}`).join('; ') || 'No performance summaries available.'}</p>
            </section>
            <section>
              <div>
                <span>Degradation Notes</span>
                <strong>{formatNumber(strategyWalkForward.degradationDetection.degradationPct)}</strong>
              </div>
              <p>{strategyWalkForward.degradationDetection.notes.join('; ') || 'No degradation detected across walk-forward windows.'}</p>
            </section>
          </div>
          <span className="event-line">{strategyWalkForward.eventType}</span>
        </article>

        <article id="strategy-monte-carlo" className={`panel strategy-monte-carlo-panel ${strategyMonteCarlo.robustnessClassification}`}>
          <div className="panel-heading">
            <h2>Monte Carlo Simulation</h2>
            <span>Paper-only randomized stress test over completed backtest outcomes.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{formatNumber(strategyMonteCarlo.simulationCount)} simulations</span>
              <strong>{strategyMonteCarlo.robustnessClassification}</strong>
            </div>
            <span className={`decision-pill ${strategyMonteCarlo.robustnessClassification === 'robust' ? 'positive' : strategyMonteCarlo.robustnessClassification === 'fragile' ? 'danger' : 'warning'}`}>
              {formatPercent(strategyMonteCarlo.probabilityOfProfitability)} profitable
            </span>
          </div>
          <p className="empty-state">{strategyMonteCarlo.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Simulation Count" value={formatNumber(strategyMonteCarlo.simulationCount)} />
            <MetricCard label="Sampled Outcomes" value={formatNumber(strategyMonteCarlo.tradeOutcomeSampling.sourceTradeCount)} />
            <MetricCard label="Drawdown Breach Probability" value={formatPercent(strategyMonteCarlo.probabilityOfDrawdownBreach)} />
            <MetricCard label="Profitability Probability" value={formatPercent(strategyMonteCarlo.probabilityOfProfitability)} />
            <MetricCard label="Median Final Equity" value={formatCurrency(strategyMonteCarlo.confidenceIntervalSummary.finalEquityP50)} />
            <MetricCard label="Worst Path P&L" value={formatCurrency(strategyMonteCarlo.worstCasePathSummary?.totalPnl ?? 0)} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Confidence Interval Summary</span>
                <strong>{formatCurrency(strategyMonteCarlo.confidenceIntervalSummary.pnlP50)}</strong>
              </div>
              <p>P05 {formatCurrency(strategyMonteCarlo.confidenceIntervalSummary.pnlP05)} / P95 {formatCurrency(strategyMonteCarlo.confidenceIntervalSummary.pnlP95)}</p>
            </section>
            <section>
              <div>
                <span>Worst-Case Path Summary</span>
                <strong>{strategyMonteCarlo.worstCasePathSummary?.id ?? 'none'}</strong>
              </div>
              <p>{formatCurrency(strategyMonteCarlo.worstCasePathSummary?.finalEquity ?? 0)} final equity / {formatPercent(strategyMonteCarlo.worstCasePathSummary?.maxDrawdown ?? 0)} max drawdown</p>
            </section>
            <section>
              <div>
                <span>Median Path Summary</span>
                <strong>{strategyMonteCarlo.medianPathSummary?.id ?? 'none'}</strong>
              </div>
              <p>{formatCurrency(strategyMonteCarlo.medianPathSummary?.finalEquity ?? 0)} final equity / {formatPercent(strategyMonteCarlo.medianPathSummary?.maxDrawdown ?? 0)} max drawdown</p>
            </section>
          </div>
          <span className="event-line">{strategyMonteCarlo.eventType}</span>
        </article>

        <article id="strategy-backtest-report" className={`panel strategy-backtest-report-panel ${strategyBacktestReport.releaseResearchRecommendation}`}>
          <div className="panel-heading">
            <h2>Backtest Report</h2>
            <span>Paper-only strategy research report generated from backtest, walk-forward, and Monte Carlo outputs.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>{strategyBacktestReport.strategySummary.strategyId}</span>
              <strong>{strategyBacktestReport.releaseResearchRecommendation}</strong>
            </div>
            <span className={`decision-pill ${strategyBacktestReport.releaseResearchRecommendation === 'approve' ? 'positive' : strategyBacktestReport.releaseResearchRecommendation === 'reject' ? 'danger' : 'warning'}`}>
              release/research recommendation
            </span>
          </div>
          <p className="empty-state">{strategyBacktestReport.summary}</p>
          <div className="research-intelligence-grid">
            <MetricCard label="Backtest Status" value={strategyBacktestReport.strategySummary.backtestExecutionStatus} />
            <MetricCard label="Net Paper P&L" value={formatCurrency(strategyBacktestReport.backtestPerformanceSummary.netRealizedPnl)} />
            <MetricCard label="Profit Factor" value={formatNumber(strategyBacktestReport.backtestPerformanceSummary.profitFactor)} />
            <MetricCard label="Walk-Forward Status" value={strategyBacktestReport.walkForwardRobustnessSummary.status} />
            <MetricCard label="Monte Carlo Risk" value={strategyBacktestReport.monteCarloRiskSummary.robustnessClassification} />
            <MetricCard label="Drawdown Breach" value={formatPercent(strategyBacktestReport.monteCarloRiskSummary.probabilityOfDrawdownBreach)} />
          </div>
          <div className="research-catalyst-list">
            <section>
              <div>
                <span>Strategy Summary</span>
                <strong>{strategyBacktestReport.strategySummary.symbol}</strong>
              </div>
              <p>{strategyBacktestReport.strategySummary.timeframe} timeframe / {formatNumber(strategyBacktestReport.strategySummary.filledTrades)} filled paper trades / {formatNumber(strategyBacktestReport.strategySummary.consumedCandles)} candles</p>
            </section>
            <section>
              <div>
                <span>Backtest Performance Summary</span>
                <strong>{formatPercent(strategyBacktestReport.backtestPerformanceSummary.winRate)}</strong>
              </div>
              <p>{strategyBacktestReport.backtestPerformanceSummary.summary}</p>
            </section>
            <section>
              <div>
                <span>Walk-Forward Robustness Summary</span>
                <strong>{formatNumber(strategyBacktestReport.walkForwardRobustnessSummary.robustnessScore)}</strong>
              </div>
              <p>{strategyBacktestReport.walkForwardRobustnessSummary.summary}</p>
            </section>
            <section>
              <div>
                <span>Monte Carlo Risk Summary</span>
                <strong>{formatPercent(strategyBacktestReport.monteCarloRiskSummary.probabilityOfProfitability)}</strong>
              </div>
              <p>{strategyBacktestReport.monteCarloRiskSummary.summary}</p>
            </section>
            <section>
              <div>
                <span>Key Strengths</span>
                <strong>{formatNumber(strategyBacktestReport.keyStrengths.length)}</strong>
              </div>
              <p>{strategyBacktestReport.keyStrengths.join('; ')}</p>
            </section>
            <section>
              <div>
                <span>Key Weaknesses</span>
                <strong>{formatNumber(strategyBacktestReport.keyWeaknesses.length)}</strong>
              </div>
              <p>{strategyBacktestReport.keyWeaknesses.join('; ')}</p>
            </section>
          </div>
          <span className="event-line">{strategyBacktestReport.eventType}</span>
        </article>

        <article id="multi-strategy" className={`panel multi-strategy-panel ${strategyPortfolioManager.strategyApprovalStatus}`}>
          <div className="panel-heading">
            <h2>Multi-Strategy Manager</h2>
            <span>Strategy-level conflict, priority, exposure, and risk budget coordination.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Strategy Approval Status</span>
              <strong>{strategyPortfolioManager.strategyApprovalStatus}</strong>
            </div>
            <span className={`decision-pill ${strategyPortfolioManager.strategyApprovalStatus === 'approved' ? 'positive' : strategyPortfolioManager.strategyApprovalStatus === 'blocked' ? 'danger' : 'warning'}`}>
              {strategyPortfolioManager.activeStrategyRegistry.length} active strategies
            </span>
          </div>
          <div className="strategy-manager-grid">
            <MetricCard label="Duplicate Symbols" value={formatNumber(strategyPortfolioManager.duplicateSymbolTrades.length)} />
            <MetricCard label="Conflicting Signals" value={formatNumber(strategyPortfolioManager.conflictingSignals.length)} />
            <MetricCard label="Priority Leader" value={strategyPortfolioManager.priorityRanking[0]?.strategy ?? 'N/A'} />
            <MetricCard label="Evaluated Trades" value={formatNumber(demoProposedTrades.length)} />
          </div>
          <div className="strategy-manager-list">
            {strategyPortfolioManager.strategyEvaluations.map((strategy) => (
              <section key={strategy.strategyId} className={`strategy-manager-card ${strategy.approvalStatus}`}>
                <div className="guardrail-card-header">
                  <div>
                    <span>Priority {strategy.priority}</span>
                    <strong>{strategy.strategy}</strong>
                  </div>
                  <span className={`decision-pill ${strategy.approvalStatus === 'approved' ? 'positive' : strategy.approvalStatus === 'blocked' ? 'danger' : 'warning'}`}>
                    {strategy.approvalStatus}
                  </span>
                </div>
                <div className="strategy-manager-metrics">
                  <MetricCard label="Exposure" value={formatPercent(strategy.proposedExposurePct)} />
                  <MetricCard label="Exposure Limit" value={formatPercent(strategy.maxExposurePct)} />
                  <MetricCard label="Risk Budget" value={formatPercent(strategy.riskBudgetPct)} />
                  <MetricCard label="AI Decision" value={strategy.aiDecision} />
                </div>
                <p className="empty-state">
                  {[...strategy.blockers, ...strategy.cautions].join('; ') || 'No strategy coordination issues detected.'}
                </p>
              </section>
            ))}
          </div>
          <span className="event-line">{strategyPortfolioManager.eventType}</span>
        </article>

        <article id="strategy-attribution" className="panel strategy-attribution-panel">
          <div className="panel-heading">
            <h2>Strategy Attribution</h2>
            <span>Paper performance by originating strategy or signal.</span>
          </div>
          <div className="strategy-grid">
            {strategyAttribution.strategies.map((strategy) => (
              <section key={strategy.strategy} className="strategy-card">
                <div className="guardrail-card-header">
                  <div>
                    <span>Strategy</span>
                    <strong>{strategy.strategy}</strong>
                  </div>
                  <span className={`decision-pill ${strategy.netRealizedPnl >= 0 ? 'positive' : 'danger'}`}>
                    {formatCurrency(strategy.netRealizedPnl)}
                  </span>
                </div>
                <div className="strategy-metrics">
                  <MetricCard label="Trades" value={formatNumber(strategy.trades)} />
                  <MetricCard label="Win Rate" value={formatPercent(strategy.winRate)} />
                  <MetricCard label="Average Win" value={formatCurrency(strategy.averageWin)} />
                  <MetricCard label="Average Loss" value={formatCurrency(strategy.averageLoss)} />
                  <MetricCard label="Profit Factor" value={formatNumber(strategy.profitFactor)} />
                  <MetricCard label="Expectancy" value={formatCurrency(strategy.expectancy)} />
                </div>
                <p className="empty-state">Symbols: {strategy.symbols.length ? strategy.symbols.join(', ') : 'No filled trades'}</p>
              </section>
            ))}
          </div>
          <span className="event-line">{strategyAttribution.eventType}</span>
        </article>

        <article id="portfolio-analytics" className="panel portfolio-analytics-panel">
          <div className="panel-heading">
            <h2>Portfolio Analytics</h2>
            <span>Independent exposure, composition, diversification, and drift evaluation.</span>
          </div>
          <div className="analytics-grid">
            <MetricCard label="Gross Exposure" value={formatPercent(portfolioAnalytics.exposure.grossExposure)} />
            <MetricCard label="Net Exposure" value={formatPercent(portfolioAnalytics.exposure.netExposure)} />
            <MetricCard label="Leverage" value={`${formatNumber(portfolioAnalytics.exposure.leverage)}x`} />
            <MetricCard label="Long Exposure" value={formatPercent(portfolioAnalytics.exposure.longExposure)} />
            <MetricCard label="Short Exposure" value={formatPercent(portfolioAnalytics.exposure.shortExposure)} />
            <MetricCard label="Diversification" value={`${formatNumber(portfolioAnalytics.diversification.score)} ${portfolioAnalytics.diversification.label}`} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Asset Class</h3>
              {portfolioAnalytics.exposure.byAssetClass.map((item) => (
                <div key={item.assetType} className="mini-row">
                  <span>{item.assetType}</span>
                  <strong>{formatPercent(item.weight)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Sector</h3>
              {portfolioAnalytics.exposure.bySector.map((item) => (
                <div key={item.name} className="mini-row">
                  <span>{item.name}</span>
                  <strong>{formatPercent(item.weight)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Symbol</h3>
              {portfolioAnalytics.exposure.bySymbol.slice(0, 5).map((item) => (
                <div key={`${item.symbol}-${item.side}`} className="mini-row">
                  <span>{item.symbol}</span>
                  <strong>{formatPercent(item.weight)}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Concentration</h3>
              <p className="empty-state">
                Largest position: {portfolioAnalytics.concentration.largestPosition?.symbol ?? 'N/A'} at {formatPercent(portfolioAnalytics.concentration.concentrationRisk)}
              </p>
            </section>
            <section>
              <h3>Drift</h3>
              {portfolioAnalytics.drift.hasDrift ? portfolioAnalytics.drift.items.slice(0, 3).map((item) => (
                <div key={`${item.scope}-${item.name}`} className="mini-row">
                  <span>{item.name}</span>
                  <strong>{formatPercent(item.driftPct)}</strong>
                </div>
              )) : <p className="empty-state">No material portfolio drift detected.</p>}
            </section>
            <section>
              <h3>Insights</h3>
              {portfolioAnalytics.insights.map((insight) => (
                <p key={insight} className="empty-state">{insight}</p>
              ))}
            </section>
          </div>
          <span className="event-line">{portfolioAnalytics.eventType}</span>
        </article>

        <article id="portfolio-correlation" className={`panel portfolio-correlation-panel ${portfolioCorrelation.correlationRiskStatus}`}>
          <div className="panel-heading">
            <h2>Portfolio Correlation</h2>
            <span>Paper-only relationship risk across assets, strategies, sectors, and exposures.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Correlation Risk Status</span>
              <strong>{portfolioCorrelation.correlationRiskStatus}</strong>
            </div>
            <span className={`decision-pill ${portfolioCorrelation.correlationRiskStatus === 'clear' ? 'positive' : portfolioCorrelation.correlationRiskStatus === 'elevated' ? 'danger' : 'warning'}`}>
              {formatPercent(portfolioCorrelation.concentrationRiskFromCorrelatedAssets.correlatedWeight)} correlated
            </span>
          </div>
          <p className="empty-state">{portfolioCorrelation.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Assets Evaluated" value={formatNumber(portfolioCorrelation.assetCorrelationMatrix.length)} />
            <MetricCard label="Correlated Symbols" value={formatNumber(portfolioCorrelation.concentrationRiskFromCorrelatedAssets.correlatedSymbolCount)} />
            <MetricCard label="Concentration Score" value={formatNumber(portfolioCorrelation.concentrationRiskFromCorrelatedAssets.concentrationScore)} />
            <MetricCard label="Adjusted Diversification" value={formatNumber(portfolioCorrelation.diversificationImpactSummary.correlationAdjustedDiversificationScore)} />
            <MetricCard label="Average Pair Correlation" value={formatNumber(portfolioCorrelation.diversificationImpactSummary.averagePairCorrelation)} />
            <MetricCard label="Strategy Quality" value={formatNumber(portfolioCorrelation.strategyCorrelationSummary.averageQualityScore)} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Asset Correlation Matrix</h3>
              {portfolioCorrelation.assetCorrelationMatrix.slice(0, 5).map((row) => (
                <div key={row.symbol} className="mini-row">
                  <span>{row.symbol}</span>
                  <strong>{row.correlations.filter((item) => item.symbol !== row.symbol && item.correlation !== null).map((item) => `${item.symbol} ${formatNumber(item.correlation)}`).join(' / ') || 'insufficient history'}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Strategy Correlation Summary</h3>
              {portfolioCorrelation.strategyCorrelationSummary.strategies.slice(0, 3).map((strategy) => (
                <div key={strategy.strategy} className="mini-row">
                  <span>{strategy.strategy}</span>
                  <strong>{strategy.pnlAlignment}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Sector Correlation Summary</h3>
              {portfolioCorrelation.sectorCorrelationSummary.slice(0, 4).map((sector) => (
                <div key={sector.sector} className="mini-row">
                  <span>{sector.sector}</span>
                  <strong>{sector.averageInternalCorrelation === null ? 'limited' : formatNumber(sector.averageInternalCorrelation)}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Correlated Concentration</h3>
              <p className="empty-state">
                Largest position: {portfolioCorrelation.concentrationRiskFromCorrelatedAssets.largestPosition?.symbol ?? 'N/A'} / high-correlation pairs: {formatNumber(portfolioCorrelation.concentrationRiskFromCorrelatedAssets.highCorrelationPairs.length)}
              </p>
            </section>
            <section>
              <h3>Diversification Impact Summary</h3>
              <p className="empty-state">
                {portfolioCorrelation.diversificationImpactSummary.diversificationLabel} base diversification shifted to {portfolioCorrelation.diversificationImpactSummary.impact} correlation-adjusted impact.
              </p>
            </section>
            <section>
              <h3>Source Events</h3>
              <p className="empty-state">
                {[portfolioCorrelation.sourceEvents.portfolioAnalytics, portfolioCorrelation.sourceEvents.strategyAttribution, portfolioCorrelation.sourceEvents.strategyBacktestPerformance, portfolioCorrelation.sourceEvents.historicalReplay].filter(Boolean).join(' / ')}
              </p>
            </section>
          </div>
          <span className="event-line">{portfolioCorrelation.eventType}</span>
        </article>

        <article id="portfolio-factor-exposure" className={`panel portfolio-factor-exposure-panel ${portfolioFactorExposure.factorRiskStatus}`}>
          <div className="panel-heading">
            <h2>Factor Exposure</h2>
            <span>Paper-only common risk factor evaluation across portfolio, strategy, regime, and backtest context.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Factor Risk Status</span>
              <strong>{portfolioFactorExposure.factorRiskStatus}</strong>
            </div>
            <span className={`decision-pill ${portfolioFactorExposure.factorRiskStatus === 'clear' ? 'positive' : portfolioFactorExposure.factorRiskStatus === 'elevated' ? 'danger' : 'warning'}`}>
              {portfolioFactorExposure.factorConcentrationSummary.dominantFactor.factor}
            </span>
          </div>
          <p className="empty-state">{portfolioFactorExposure.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Market Beta Exposure" value={formatNumber(portfolioFactorExposure.marketBetaExposure.weightedBeta)} />
            <MetricCard label="Momentum Exposure" value={formatNumber(portfolioFactorExposure.momentumFactorExposure.weightedMomentumScore)} />
            <MetricCard label="Volatility Exposure" value={formatNumber(portfolioFactorExposure.volatilityFactorExposure.weightedVolatility)} />
            <MetricCard label="Sector Factor" value={portfolioFactorExposure.sectorFactorExposure.dominantSector?.sector ?? 'N/A'} />
            <MetricCard label="Asset-Class Factor" value={portfolioFactorExposure.assetClassFactorExposure.dominantFactor?.assetType ?? 'N/A'} />
            <MetricCard label="Strategy Factor Risk" value={formatNumber(portfolioFactorExposure.strategyFactorExposure.averageRiskContribution)} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Market Beta Exposure</h3>
              <p className="empty-state">
                {formatNumber(portfolioFactorExposure.marketBetaExposure.exposureScore)} score / {formatPercent(portfolioFactorExposure.marketBetaExposure.highBetaWeight)} high beta weight / {portfolioFactorExposure.marketBetaExposure.status}
              </p>
            </section>
            <section>
              <h3>Momentum Factor Exposure</h3>
              <p className="empty-state">
                {portfolioFactorExposure.momentumFactorExposure.trendAlignment} with {portfolioFactorExposure.momentumFactorExposure.trendRegime} / {formatPercent(portfolioFactorExposure.momentumFactorExposure.proMomentumWeight)} pro-momentum weight.
              </p>
            </section>
            <section>
              <h3>Volatility Factor Exposure</h3>
              <p className="empty-state">
                {portfolioFactorExposure.volatilityFactorExposure.volatilityRegime} regime / {formatPercent(portfolioFactorExposure.volatilityFactorExposure.highVolatilityWeight)} high volatility weight / {portfolioFactorExposure.volatilityFactorExposure.status}
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Sector Factor Exposure</h3>
              {portfolioFactorExposure.sectorFactorExposure.sectors.slice(0, 4).map((sector) => (
                <div key={sector.sector} className="mini-row">
                  <span>{sector.sector}</span>
                  <strong>{formatNumber(sector.factorScore)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Asset-Class Factor Exposure</h3>
              {portfolioFactorExposure.assetClassFactorExposure.factors.slice(0, 4).map((factor) => (
                <div key={factor.assetType} className="mini-row">
                  <span>{factor.assetType}</span>
                  <strong>{formatPercent(factor.weight)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Strategy Factor Exposure</h3>
              {portfolioFactorExposure.strategyFactorExposure.strategies.slice(0, 3).map((strategy) => (
                <div key={strategy.strategy} className="mini-row">
                  <span>{strategy.strategy}</span>
                  <strong>{strategy.pnlAlignment}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Factor Concentration Summary</h3>
              {portfolioFactorExposure.factorConcentrationSummary.factorScores.map((factor) => (
                <div key={factor.factor} className="mini-row">
                  <span>{factor.factor}</span>
                  <strong>{formatNumber(factor.score)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Elevated Factors</h3>
              <p className="empty-state">
                {portfolioFactorExposure.factorConcentrationSummary.elevatedFactors.map((factor) => factor.factor).join(', ') || 'No elevated factor concentrations detected.'}
              </p>
            </section>
            <section>
              <h3>Source Events</h3>
              <p className="empty-state">
                {[portfolioFactorExposure.sourceEvents.portfolioAnalytics, portfolioFactorExposure.sourceEvents.portfolioCorrelation, portfolioFactorExposure.sourceEvents.strategyAttribution, portfolioFactorExposure.sourceEvents.marketRegime, portfolioFactorExposure.sourceEvents.strategyBacktestPerformance].filter(Boolean).join(' / ')}
              </p>
            </section>
          </div>
          <span className="event-line">{portfolioFactorExposure.eventType}</span>
        </article>

        <article id="portfolio-optimization" className={`panel portfolio-optimization-panel ${portfolioOptimization.recommendationPriority}`}>
          <div className="panel-heading">
            <h2>Portfolio Optimization</h2>
            <span>Paper-only optimization recommendations. No live orders or brokerage execution.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Recommendation Priority</span>
              <strong>{portfolioOptimization.recommendationPriority}</strong>
            </div>
            <span className={`decision-pill ${portfolioOptimization.recommendationPriority === 'low' ? 'positive' : portfolioOptimization.recommendationPriority === 'high' ? 'danger' : 'warning'}`}>
              {formatNumber(portfolioOptimization.optimizationConfidenceScore)} confidence
            </span>
          </div>
          <p className="empty-state">{portfolioOptimization.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Total Recommendations" value={formatNumber(portfolioOptimization.recommendationSummary.totalRecommendations)} />
            <MetricCard label="High Priority" value={formatNumber(portfolioOptimization.recommendationSummary.highPriority)} />
            <MetricCard label="Medium Priority" value={formatNumber(portfolioOptimization.recommendationSummary.mediumPriority)} />
            <MetricCard label="Risk Reduction" value={formatNumber(portfolioOptimization.riskReductionRecommendations.length)} />
            <MetricCard label="Factor Adjustments" value={formatNumber(portfolioOptimization.factorExposureAdjustmentRecommendations.length)} />
            <MetricCard label="Strategy Allocation" value={formatNumber(portfolioOptimization.strategyAllocationRecommendations.length)} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Risk Reduction Recommendations</h3>
              {portfolioOptimization.riskReductionRecommendations.slice(0, 3).map((item) => (
                <div key={item.id} className="mini-row">
                  <span>{item.action}</span>
                  <strong>{item.priority}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Diversification Recommendations</h3>
              {portfolioOptimization.diversificationRecommendations.slice(0, 3).map((item) => (
                <div key={item.id} className="mini-row">
                  <span>{item.action}</span>
                  <strong>{item.priority}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Factor Exposure Adjustments</h3>
              {portfolioOptimization.factorExposureAdjustmentRecommendations.slice(0, 3).map((item) => (
                <div key={item.id} className="mini-row">
                  <span>{item.action}</span>
                  <strong>{item.priority}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Correlation Reduction Recommendations</h3>
              {portfolioOptimization.correlationReductionRecommendations.slice(0, 3).map((item) => (
                <div key={item.id} className="mini-row">
                  <span>{item.action}</span>
                  <strong>{item.priority}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Capital Allocation Adjustments</h3>
              {portfolioOptimization.capitalAllocationAdjustmentRecommendations.slice(0, 3).map((item) => (
                <div key={item.id} className="mini-row">
                  <span>{item.action}</span>
                  <strong>{item.priority}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Strategy Allocation Recommendations</h3>
              {portfolioOptimization.strategyAllocationRecommendations.slice(0, 3).map((item) => (
                <div key={item.id} className="mini-row">
                  <span>{item.action}</span>
                  <strong>{item.priority}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Optimization Confidence Score</h3>
              <p className="empty-state">{formatNumber(portfolioOptimization.optimizationConfidenceScore)} confidence from reused risk, allocation, performance, factor, and correlation outputs.</p>
            </section>
            <section>
              <h3>Recommendation Guardrails</h3>
              <p className="empty-state">Recommendations only / paper trading only / no brokerage execution.</p>
            </section>
            <section>
              <h3>Source Events</h3>
              <p className="empty-state">
                {[portfolioOptimization.sourceEvents.portfolioAnalytics, portfolioOptimization.sourceEvents.portfolioCorrelation, portfolioOptimization.sourceEvents.portfolioFactorExposure, portfolioOptimization.sourceEvents.capitalAllocation, portfolioOptimization.sourceEvents.portfolioRisk, portfolioOptimization.sourceEvents.performance, portfolioOptimization.sourceEvents.strategyAttribution].filter(Boolean).join(' / ')}
              </p>
            </section>
          </div>
          <span className="event-line">{portfolioOptimization.eventType}</span>
        </article>

        <article id="portfolio-optimization-governance" className={`panel portfolio-optimization-governance-panel ${portfolioOptimizationGovernance.governanceStatus}`}>
          <div className="panel-heading">
            <h2>Optimization Governance</h2>
            <span>Governance and review only before recommendations influence AI decisions or operator actions.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Governance Status</span>
              <strong>{portfolioOptimizationGovernance.governanceStatus}</strong>
            </div>
            <span className={`decision-pill ${portfolioOptimizationGovernance.governanceStatus === 'approved' ? 'positive' : portfolioOptimizationGovernance.governanceStatus === 'rejected' ? 'danger' : 'warning'}`}>
              {portfolioOptimizationGovernance.operatorActionClassification.classification}
            </span>
          </div>
          <p className="empty-state">{portfolioOptimizationGovernance.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Approval Review" value={portfolioOptimizationGovernance.recommendationApprovalReview.status} />
            <MetricCard label="Risk Impact" value={portfolioOptimizationGovernance.riskImpactReview.status} />
            <MetricCard label="Correlation Impact" value={portfolioOptimizationGovernance.correlationImpactReview.status} />
            <MetricCard label="Factor Impact" value={portfolioOptimizationGovernance.factorExposureImpactReview.status} />
            <MetricCard label="Capital Impact" value={portfolioOptimizationGovernance.capitalAllocationImpactReview.status} />
            <MetricCard label="AI Influence" value={portfolioOptimizationGovernance.operatorActionClassification.allowedToInfluenceAiDecision ? 'allowed' : 'blocked'} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Recommendation Approval Review</h3>
              <p className="empty-state">
                {formatNumber(portfolioOptimizationGovernance.recommendationApprovalReview.approvedRecommendations)} approved / {formatNumber(portfolioOptimizationGovernance.recommendationApprovalReview.rejectedRecommendations)} rejected / {formatNumber(portfolioOptimizationGovernance.recommendationApprovalReview.highPriority)} high priority.
              </p>
            </section>
            <section>
              <h3>Risk Impact Review</h3>
              <p className="empty-state">
                {portfolioOptimizationGovernance.riskImpactReview.riskLevel} risk / {formatNumber(portfolioOptimizationGovernance.riskImpactReview.riskScore)} score / {formatPercent(portfolioOptimizationGovernance.riskImpactReview.openRiskPct)} open risk.
              </p>
            </section>
            <section>
              <h3>Correlation Impact Review</h3>
              <p className="empty-state">
                {portfolioOptimizationGovernance.correlationImpactReview.correlationRiskStatus} correlation / {formatPercent(portfolioOptimizationGovernance.correlationImpactReview.correlatedWeight)} correlated / {formatNumber(portfolioOptimizationGovernance.correlationImpactReview.highCorrelationPairCount)} high pairs.
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Factor Exposure Impact Review</h3>
              <p className="empty-state">
                {portfolioOptimizationGovernance.factorExposureImpactReview.factorRiskStatus} factor risk / elevated: {portfolioOptimizationGovernance.factorExposureImpactReview.elevatedFactors.join(', ') || 'none'}
              </p>
            </section>
            <section>
              <h3>Capital Allocation Impact Review</h3>
              <p className="empty-state">
                {portfolioOptimizationGovernance.capitalAllocationImpactReview.allocationStatus} allocation / available paper capital {formatCurrency(portfolioOptimizationGovernance.capitalAllocationImpactReview.availableCapital)}
              </p>
            </section>
            <section>
              <h3>Operator Action Classification</h3>
              <p className="empty-state">
                {portfolioOptimizationGovernance.operatorActionClassification.rationale}
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>AI Decision Review</h3>
              <p className="empty-state">
                {portfolioOptimizationGovernance.aiDecisionReview.finalDecision} / {formatNumber(portfolioOptimizationGovernance.aiDecisionReview.blockerCount)} blockers / {formatNumber(portfolioOptimizationGovernance.aiDecisionReview.cautionCount)} cautions.
              </p>
            </section>
            <section>
              <h3>Governance Guardrails</h3>
              <p className="empty-state">Paper trading only / no live orders / no brokerage integration / governance and review only.</p>
            </section>
            <section>
              <h3>Source Events</h3>
              <p className="empty-state">
                {[portfolioOptimizationGovernance.sourceEvents.portfolioOptimization, portfolioOptimizationGovernance.sourceEvents.portfolioRisk, portfolioOptimizationGovernance.sourceEvents.portfolioCorrelation, portfolioOptimizationGovernance.sourceEvents.portfolioFactorExposure, portfolioOptimizationGovernance.sourceEvents.capitalAllocation, portfolioOptimizationGovernance.sourceEvents.aiDecision].filter(Boolean).join(' / ')}
              </p>
            </section>
          </div>
          <span className="event-line">{portfolioOptimizationGovernance.eventType}</span>
        </article>

        <article className="panel rebalance-panel">
          <div className="panel-heading">
            <h2>Rebalancing Recommendations</h2>
            <span>Recommendations only. No automatic trades.</span>
          </div>
          <div className="rebalance-summary">
            <MetricCard label="Confidence" value={formatPercent(rebalancing.confidence)} />
            <MetricCard label="Actions" value={formatNumber(rebalancing.recommendations.length)} />
            <MetricCard label="Reductions" value={formatNumber(rebalancing.actionCounts.reduce ?? 0)} />
            <MetricCard label="Adds" value={formatNumber(rebalancing.actionCounts.add ?? 0)} />
          </div>
          <p className="empty-state">{rebalancing.rationaleSummary}</p>
          <div className="rebalance-grid">
            {rebalancing.recommendations.map((action) => (
              <section key={`${action.type}-${action.scope}-${action.target}`} className={`rebalance-card ${action.type}`}>
                <div className="guardrail-card-header">
                  <div>
                    <span>{action.scope}</span>
                    <strong>{action.target}</strong>
                  </div>
                  <span className={`decision-pill ${action.type === 'reduce' ? 'danger' : action.type === 'add' ? 'positive' : 'warning'}`}>
                    {action.type}
                  </span>
                </div>
                <p>{action.rationale}</p>
                <div className="rebalance-metrics">
                  <MetricCard label="Priority" value={action.priority} />
                  <MetricCard label="Confidence" value={formatPercent(action.confidence)} />
                </div>
              </section>
            ))}
          </div>
          <span className="event-line">{rebalancing.eventType}</span>
        </article>

        <article id="event-observability" className={`panel event-observability-panel ${eventObservability.observabilityStatus}`}>
          <div className="panel-heading">
            <h2>Event Observability</h2>
            <span>Enterprise event health across trading, research, strategy, backtesting, optimization, and release readiness.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Observability Status</span>
              <strong>{eventObservability.observabilityStatus}</strong>
            </div>
            <span className={`decision-pill ${eventObservability.observabilityStatus === 'healthy' ? 'positive' : eventObservability.observabilityStatus === 'degraded' ? 'danger' : 'warning'}`}>
              {formatNumber(eventObservability.eventCatalogSummary.uniqueEventTypes)} contracts
            </span>
          </div>
          <p className="empty-state">{eventObservability.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Catalog Events" value={formatNumber(eventObservability.eventCatalogSummary.totalEvents)} />
            <MetricCard label="Event Families" value={formatNumber(eventObservability.eventFamilyGrouping.length)} />
            <MetricCard label="Fresh Events" value={formatNumber(eventObservability.eventFreshnessCheck.freshCount)} />
            <MetricCard label="Missing Events" value={formatNumber(eventObservability.missingEventDetection.missingCount)} />
            <MetricCard label="Duplicate Events" value={formatNumber(eventObservability.duplicateEventDetection.duplicateCount)} />
            <MetricCard label="Critical Health" value={eventObservability.criticalEventHealthStatus.status} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Event Catalog Summary</h3>
              <p className="empty-state">
                {formatNumber(eventObservability.eventCatalogSummary.paperTradingEvents)} paper events / {formatNumber(eventObservability.eventCatalogSummary.cautionEvents)} caution / {formatNumber(eventObservability.eventCatalogSummary.degradedEvents)} degraded.
              </p>
            </section>
            <section>
              <h3>Event Family Grouping</h3>
              {eventObservability.eventFamilyGrouping.slice(0, 6).map((family) => (
                <div key={family.family} className="mini-row">
                  <span>{family.family}</span>
                  <strong>{formatNumber(family.uniqueEventTypes)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Event Freshness Check</h3>
              <p className="empty-state">
                {formatNumber(eventObservability.eventFreshnessCheck.staleCount)} stale events from {formatNumber(eventObservability.eventFreshnessCheck.checkedCount)} checked observations.
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Missing Event Detection</h3>
              <p className="empty-state">
                {eventObservability.missingEventDetection.missingEventTypes.join(', ') || 'Required event contracts are present.'}
              </p>
            </section>
            <section>
              <h3>Duplicate Event Detection</h3>
              <p className="empty-state">
                {eventObservability.duplicateEventDetection.duplicates.map((item) => `${item.eventType} x${item.count}`).join('; ') || 'No duplicate event contracts detected.'}
              </p>
            </section>
            <section>
              <h3>Critical Event Health Status</h3>
              <p className="empty-state">
                {eventObservability.criticalEventHealthStatus.status} / missing critical: {eventObservability.criticalEventHealthStatus.missingCritical.join(', ') || 'none'}
              </p>
            </section>
          </div>
          <span className="event-line">{eventObservability.eventType}</span>
        </article>

        <article id="system-health-command-center" className={`panel system-health-command-center-panel ${systemHealthCommandCenter.finalPlatformHealthStatus}`}>
          <div className="panel-heading">
            <h2>System Health Command Center</h2>
            <span>Enterprise operational readiness across all major Atlas paper-trading modules.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Final Platform Health Status</span>
              <strong>{systemHealthCommandCenter.finalPlatformHealthStatus}</strong>
            </div>
            <span className={`decision-pill ${systemHealthCommandCenter.finalPlatformHealthStatus === 'operational' ? 'positive' : systemHealthCommandCenter.finalPlatformHealthStatus === 'degraded' ? 'danger' : 'warning'}`}>
              {formatNumber(systemHealthCommandCenter.moduleHealthRegistry.length)} modules
            </span>
          </div>
          <p className="empty-state">{systemHealthCommandCenter.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Trading Lifecycle" value={systemHealthCommandCenter.tradingLifecycleHealthSummary.status} />
            <MetricCard label="Research Stack" value={systemHealthCommandCenter.researchStackHealthSummary.status} />
            <MetricCard label="Strategy Stack" value={systemHealthCommandCenter.strategyStackHealthSummary.status} />
            <MetricCard label="Backtesting Stack" value={systemHealthCommandCenter.backtestingStackHealthSummary.status} />
            <MetricCard label="Portfolio Analytics" value={systemHealthCommandCenter.portfolioAnalyticsHealthSummary.status} />
            <MetricCard label="Event Observability" value={systemHealthCommandCenter.eventObservabilityHealthSummary.status} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Module Health Registry</h3>
              {systemHealthCommandCenter.moduleHealthRegistry.slice(0, 6).map((module) => (
                <div key={module.id} className="mini-row">
                  <span>{module.name}</span>
                  <strong>{module.healthStatus}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Trading Lifecycle Health Summary</h3>
              <p className="empty-state">
                {formatNumber(systemHealthCommandCenter.tradingLifecycleHealthSummary.operationalCount)} operational / {formatNumber(systemHealthCommandCenter.tradingLifecycleHealthSummary.cautionCount)} caution / {formatNumber(systemHealthCommandCenter.tradingLifecycleHealthSummary.degradedCount)} degraded.
              </p>
            </section>
            <section>
              <h3>Research Stack Health Summary</h3>
              <p className="empty-state">
                {formatNumber(systemHealthCommandCenter.researchStackHealthSummary.operationalCount)} operational modules across research intelligence, scoring, context, regime, and AI integration.
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Strategy Stack Health Summary</h3>
              <p className="empty-state">
                {systemHealthCommandCenter.strategyStackHealthSummary.status} / {formatNumber(systemHealthCommandCenter.strategyStackHealthSummary.moduleCount)} modules reviewed.
              </p>
            </section>
            <section>
              <h3>Backtesting Stack Health Summary</h3>
              <p className="empty-state">
                {systemHealthCommandCenter.backtestingStackHealthSummary.status} / {formatNumber(systemHealthCommandCenter.backtestingStackHealthSummary.moduleCount)} modules reviewed.
              </p>
            </section>
            <section>
              <h3>Portfolio Analytics Health Summary</h3>
              <p className="empty-state">
                {systemHealthCommandCenter.portfolioAnalyticsHealthSummary.status} / optimization, governance, factor, correlation, analytics, attribution, and rebalance outputs reviewed.
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Adapter Mock-Mode Health Summary</h3>
              <p className="empty-state">
                {systemHealthCommandCenter.adapterMockModeHealthSummary.status} / market data and broker adapters remain paper-mode only.
              </p>
            </section>
            <section>
              <h3>Event Observability Health Summary</h3>
              <p className="empty-state">
                {systemHealthCommandCenter.eventObservabilityHealthSummary.status} / source event {systemHealthCommandCenter.sourceEvents.eventObservability ?? 'none'}.
              </p>
            </section>
            <section>
              <h3>Release Readiness Inputs</h3>
              <p className="empty-state">
                {[systemHealthCommandCenter.sourceEvents.releaseReadiness, systemHealthCommandCenter.sourceEvents.releaseCandidateStabilization].filter(Boolean).join(' / ')}
              </p>
            </section>
          </div>
          <span className="event-line">{systemHealthCommandCenter.eventType}</span>
        </article>

        <article id="operator-action-center" className={`panel operator-action-center-panel ${operatorActionCenter.platformActionSummary.topSeverity}`}>
          <div className="panel-heading">
            <h2>Operator Action Center</h2>
            <span>Human review actions only. Paper trading, no live orders, no brokerage execution.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Platform Action Summary</span>
              <strong>{operatorActionCenter.platformActionSummary.topSeverity}</strong>
            </div>
            <span className={`decision-pill ${operatorActionCenter.platformActionSummary.topSeverity === 'critical' ? 'danger' : operatorActionCenter.platformActionSummary.topSeverity === 'high' ? 'warning' : 'positive'}`}>
              {formatNumber(operatorActionCenter.platformActionSummary.openActions)} open
            </span>
          </div>
          <p className="empty-state">{operatorActionCenter.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Total Actions" value={formatNumber(operatorActionCenter.platformActionSummary.totalActions)} />
            <MetricCard label="Critical" value={formatNumber(operatorActionCenter.platformActionSummary.bySeverity.critical)} />
            <MetricCard label="High" value={formatNumber(operatorActionCenter.platformActionSummary.bySeverity.high)} />
            <MetricCard label="Review" value={formatNumber(operatorActionCenter.platformActionSummary.byCategory.review)} />
            <MetricCard label="Reduce Risk" value={formatNumber(operatorActionCenter.platformActionSummary.byCategory['reduce risk'])} />
            <MetricCard label="Investigate" value={formatNumber(operatorActionCenter.platformActionSummary.byCategory.investigate)} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Prioritized Operator Action List</h3>
              {operatorActionCenter.prioritizedOperatorActions.slice(0, 5).map((action) => (
                <div key={action.id} className="mini-row">
                  <span>{action.title}</span>
                  <strong>{action.severity}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Action Categories</h3>
              {Object.entries(operatorActionCenter.platformActionSummary.byCategory).map(([category, count]) => (
                <div key={category} className="mini-row">
                  <span>{category}</span>
                  <strong>{formatNumber(count)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Action Severity</h3>
              {Object.entries(operatorActionCenter.platformActionSummary.bySeverity).map(([severity, count]) => (
                <div key={severity} className="mini-row">
                  <span>{severity}</span>
                  <strong>{formatNumber(count)}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Action Source References</h3>
              <p className="empty-state">
                {Object.values(operatorActionCenter.sourceEvents).filter(Boolean).join(' / ')}
              </p>
            </section>
            <section>
              <h3>Action Rationale</h3>
              <p className="empty-state">
                {operatorActionCenter.prioritizedOperatorActions[0]?.rationale ?? 'No operator action rationale available.'}
              </p>
            </section>
            <section>
              <h3>Action Status</h3>
              <p className="empty-state">
                {formatNumber(operatorActionCenter.platformActionSummary.openActions)} open / human review only / no execution automation.
              </p>
            </section>
          </div>
          <span className="event-line">{operatorActionCenter.eventType}</span>
        </article>

        <article id="enterprise-audit-trail" className={`panel enterprise-audit-trail-panel ${enterpriseAuditTrail.auditIntegrityStatus.status}`}>
          <div className="panel-heading">
            <h2>Enterprise Audit Trail</h2>
            <span>Normalized paper-only audit records across events, actions, lifecycle, risk, and release readiness.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Audit Integrity Status</span>
              <strong>{enterpriseAuditTrail.auditIntegrityStatus.status}</strong>
            </div>
            <span className={`decision-pill ${enterpriseAuditTrail.auditIntegrityStatus.status === 'invalid' ? 'danger' : enterpriseAuditTrail.auditIntegrityStatus.status === 'caution' ? 'warning' : 'positive'}`}>
              {formatNumber(enterpriseAuditTrail.normalizedAuditRecords.length)} records
            </span>
          </div>
          <p className="empty-state">{enterpriseAuditTrail.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Normalized Audit Records" value={formatNumber(enterpriseAuditTrail.normalizedAuditRecords.length)} />
            <MetricCard label="Audit Categories" value={formatNumber(enterpriseAuditTrail.auditCategoryGrouping.length)} />
            <MetricCard label="Highest Severity" value={enterpriseAuditTrail.auditSeverityClassification.highestSeverity} />
            <MetricCard label="Critical Records" value={formatNumber(enterpriseAuditTrail.auditSeverityClassification.critical)} />
            <MetricCard label="Operator References" value={formatNumber(enterpriseAuditTrail.operatorActionReferences.length)} />
            <MetricCard label="Risk References" value={formatNumber(enterpriseAuditTrail.riskDecisionReferences.length)} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Audit Category Grouping</h3>
              {enterpriseAuditTrail.auditCategoryGrouping.map((group) => (
                <div key={group.category} className="mini-row">
                  <span>{group.category}</span>
                  <strong>{group.highestSeverity}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Audit Severity Classification</h3>
              {Object.entries(enterpriseAuditTrail.auditSeverityClassification)
                .filter(([severity]) => severity !== 'highestSeverity')
                .map(([severity, count]) => (
                  <div key={severity} className="mini-row">
                    <span>{severity}</span>
                    <strong>{formatNumber(count)}</strong>
                  </div>
                ))}
            </section>
            <section>
              <h3>Actor / Source Attribution</h3>
              {enterpriseAuditTrail.actorSourceAttribution.slice(0, 5).map((attribution) => (
                <div key={attribution.auditRecordId} className="mini-row">
                  <span>{attribution.actor}</span>
                  <strong>{attribution.source}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Event Chain References</h3>
              <p className="empty-state">
                {enterpriseAuditTrail.eventChainReferences.slice(0, 8).join(' / ')}
              </p>
            </section>
            <section>
              <h3>Operator Action References</h3>
              <p className="empty-state">
                {enterpriseAuditTrail.operatorActionReferences.slice(0, 5).join(' / ') || 'No operator action references.'}
              </p>
            </section>
            <section>
              <h3>Strategy Lifecycle References</h3>
              <p className="empty-state">
                {enterpriseAuditTrail.strategyLifecycleReferences.join(' / ') || 'No strategy lifecycle references.'}
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Risk Decision References</h3>
              <p className="empty-state">
                {enterpriseAuditTrail.riskDecisionReferences.join(' / ') || 'No risk decision references.'}
              </p>
            </section>
            <section>
              <h3>Event Output</h3>
              <p className="empty-state">
                Paper trading audit only / no live orders / no brokerage execution.
              </p>
            </section>
            <section>
              <h3>Integrity Checks</h3>
              <p className="empty-state">
                {formatNumber(enterpriseAuditTrail.auditIntegrityStatus.missingEventTypeCount)} missing event types / {formatNumber(enterpriseAuditTrail.auditIntegrityStatus.unsafeRecordCount)} unsafe records.
              </p>
            </section>
          </div>
          <span className="event-line">{enterpriseAuditTrail.eventType}</span>
        </article>

        <article id="enterprise-release-control" className={`panel enterprise-release-control-panel ${enterpriseReleaseControl.finalReleaseStatus}`}>
          <div className="panel-heading">
            <h2>Enterprise Release Control</h2>
            <span>Final paper-only release decision across readiness, stabilization, health, observability, operator actions, and audit.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Release Decision Summary</span>
              <strong>{enterpriseReleaseControl.finalReleaseStatus}</strong>
            </div>
            <span className={`decision-pill ${enterpriseReleaseControl.finalReleaseStatus === 'blocked' ? 'danger' : enterpriseReleaseControl.finalReleaseStatus === 'caution' ? 'warning' : 'positive'}`}>
              {formatNumber(enterpriseReleaseControl.releaseDecisionSummary.passedGateCount)} passed
            </span>
          </div>
          <p className="empty-state">{enterpriseReleaseControl.releaseRationaleSummary}</p>
          <div className="analytics-grid">
            <MetricCard label="Final Release Status" value={enterpriseReleaseControl.finalReleaseStatus} />
            <MetricCard label="Passed Gates" value={formatNumber(enterpriseReleaseControl.releaseDecisionSummary.passedGateCount)} />
            <MetricCard label="Caution Gates" value={formatNumber(enterpriseReleaseControl.releaseDecisionSummary.cautionGateCount)} />
            <MetricCard label="Blocked Gates" value={formatNumber(enterpriseReleaseControl.releaseDecisionSummary.blockedGateCount)} />
            <MetricCard label="Paper Trading Only" value={enterpriseReleaseControl.releaseDecisionSummary.paperTradingOnly ? 'yes' : 'no'} />
            <MetricCard label="Live Orders" value={enterpriseReleaseControl.releaseDecisionSummary.liveOrders ? 'enabled' : 'disabled'} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Readiness Gate Review</h3>
              <div className="mini-row">
                <span>{enterpriseReleaseControl.readinessGateReview.sourceStatus}</span>
                <strong>{enterpriseReleaseControl.readinessGateReview.status}</strong>
              </div>
              <p className="empty-state">{enterpriseReleaseControl.readinessGateReview.summary}</p>
            </section>
            <section>
              <h3>Stabilization Gate Review</h3>
              <div className="mini-row">
                <span>{enterpriseReleaseControl.stabilizationGateReview.sourceStatus}</span>
                <strong>{enterpriseReleaseControl.stabilizationGateReview.status}</strong>
              </div>
              <p className="empty-state">{enterpriseReleaseControl.stabilizationGateReview.summary}</p>
            </section>
            <section>
              <h3>System Health Gate Review</h3>
              <div className="mini-row">
                <span>{enterpriseReleaseControl.systemHealthGateReview.sourceStatus}</span>
                <strong>{enterpriseReleaseControl.systemHealthGateReview.status}</strong>
              </div>
              <p className="empty-state">{enterpriseReleaseControl.systemHealthGateReview.summary}</p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Event Observability Gate Review</h3>
              <div className="mini-row">
                <span>{enterpriseReleaseControl.eventObservabilityGateReview.sourceStatus}</span>
                <strong>{enterpriseReleaseControl.eventObservabilityGateReview.status}</strong>
              </div>
              <p className="empty-state">
                {(enterpriseReleaseControl.eventObservabilityGateReview.references ?? []).slice(0, 5).join(' / ') || 'No observability references.'}
              </p>
            </section>
            <section>
              <h3>Operator Action Gate Review</h3>
              <div className="mini-row">
                <span>{enterpriseReleaseControl.operatorActionGateReview.sourceStatus}</span>
                <strong>{enterpriseReleaseControl.operatorActionGateReview.status}</strong>
              </div>
              <p className="empty-state">
                {(enterpriseReleaseControl.operatorActionGateReview.references ?? []).slice(0, 5).join(' / ') || 'No operator action references.'}
              </p>
            </section>
            <section>
              <h3>Audit Trail Gate Review</h3>
              <div className="mini-row">
                <span>{enterpriseReleaseControl.auditTrailGateReview.sourceStatus}</span>
                <strong>{enterpriseReleaseControl.auditTrailGateReview.status}</strong>
              </div>
              <p className="empty-state">
                {(enterpriseReleaseControl.auditTrailGateReview.references ?? []).slice(0, 5).join(' / ') || 'No audit references.'}
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Release Rationale Summary</h3>
              <p className="empty-state">{enterpriseReleaseControl.releaseRationaleSummary}</p>
            </section>
            <section>
              <h3>Source Event Chain</h3>
              <p className="empty-state">
                {Object.values(enterpriseReleaseControl.sourceEvents).filter(Boolean).join(' / ')}
              </p>
            </section>
            <section>
              <h3>Release Safety Boundary</h3>
              <p className="empty-state">
                Paper trading only / no live orders / no brokerage integration.
              </p>
            </section>
          </div>
          <span className="event-line">{enterpriseReleaseControl.eventType}</span>
        </article>

        <article id="workspace-persistence" className={`panel workspace-persistence-panel ${workspacePersistence.persistenceStatus}`}>
          <div className="panel-heading">
            <h2>Workspace Persistence</h2>
            <span>Prepared operator workspace state only. No authentication, multi-user support, live orders, or brokerage integration.</span>
          </div>
          <div className="guardrail-card-header">
            <div>
              <span>Workspace Persistence Model</span>
              <strong>{workspacePersistence.persistenceStatus}</strong>
            </div>
            <span className={`decision-pill ${workspacePersistence.persistenceStatus === 'caution' ? 'warning' : 'positive'}`}>
              {formatNumber(workspacePersistence.savedDashboardLayoutState.panels.length)} panels
            </span>
          </div>
          <p className="empty-state">{workspacePersistence.summary}</p>
          <div className="analytics-grid">
            <MetricCard label="Saved Dashboard Layout State" value={workspacePersistence.savedDashboardLayoutState.layoutId} />
            <MetricCard label="Saved Panel Visibility State" value={formatNumber(Object.keys(workspacePersistence.savedPanelVisibilityState).length)} />
            <MetricCard label="Saved Operator Preferences" value={workspacePersistence.savedOperatorPreferences.density} />
            <MetricCard label="Saved Paper-Mode Environment Profile" value={workspacePersistence.savedPaperModeEnvironmentProfile.tradingMode} />
            <MetricCard label="Local Persistence Adapter" value={workspacePersistence.localPersistenceAdapter.status} />
            <MetricCard label="PostgreSQL Interface" value={workspacePersistence.futurePostgresPersistenceInterface.status} />
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Dashboard Layout State</h3>
              {workspacePersistence.savedDashboardLayoutState.panels.slice(0, 6).map((panel) => (
                <div key={panel.id} className="mini-row">
                  <span>{panel.label}</span>
                  <strong>{panel.sortOrder}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Panel Visibility State</h3>
              {Object.entries(workspacePersistence.savedPanelVisibilityState).slice(0, 6).map(([panelId, state]) => (
                <div key={panelId} className="mini-row">
                  <span>{panelId}</span>
                  <strong>{state.visible ? 'visible' : 'hidden'}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>Operator Preferences</h3>
              <div className="mini-row">
                <span>theme</span>
                <strong>{workspacePersistence.savedOperatorPreferences.theme}</strong>
              </div>
              <div className="mini-row">
                <span>default panel</span>
                <strong>{workspacePersistence.savedOperatorPreferences.defaultLandingPanel}</strong>
              </div>
              <div className="mini-row">
                <span>event refresh</span>
                <strong>{workspacePersistence.savedOperatorPreferences.eventRefreshMode}</strong>
              </div>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Paper-Mode Environment Profile</h3>
              <p className="empty-state">
                {workspacePersistence.savedPaperModeEnvironmentProfile.releaseStatus} release / {workspacePersistence.savedPaperModeEnvironmentProfile.platformHealthStatus} health / {workspacePersistence.savedPaperModeEnvironmentProfile.operatorActionSeverity} operator severity.
              </p>
            </section>
            <section>
              <h3>Local Persistence Adapter</h3>
              <p className="empty-state">
                {workspacePersistence.localPersistenceAdapter.name} / {workspacePersistence.localPersistenceAdapter.status} / key {workspacePersistence.localPersistenceAdapter.storageKey ?? 'browser-local'}.
              </p>
            </section>
            <section>
              <h3>Future PostgreSQL Persistence Interface</h3>
              <p className="empty-state">
                {workspacePersistence.futurePostgresPersistenceInterface.operations.join(' / ')} / placeholder only.
              </p>
            </section>
          </div>
          <div className="analytics-columns">
            <section>
              <h3>Persistence Source Events</h3>
              <p className="empty-state">
                {Object.values(workspacePersistence.sourceEvents).filter(Boolean).join(' / ')}
              </p>
            </section>
            <section>
              <h3>Persistence Boundaries</h3>
              <p className="empty-state">
                No authentication yet / no multi-user support yet / no trading logic changes.
              </p>
            </section>
            <section>
              <h3>Adapter Safety</h3>
              <p className="empty-state">
                Paper trading only / no live orders / no brokerage integration.
              </p>
            </section>
          </div>
          <span className="event-line">{workspacePersistence.eventType}</span>
        </article>

        <article id="event-timeline" className="panel event-timeline-panel">
          <div className="panel-heading">
            <h2>Event Timeline</h2>
            <span>Event-driven paper trading lifecycle sequence.</span>
          </div>
          <ol className="event-timeline">
            {eventTimeline.map((event) => (
              <li key={`${event.eventType}-${event.label}`} className="event-timeline-item">
                <div>
                  <strong>{event.label}</strong>
                  <span>{event.eventType}</span>
                </div>
                <div>
                  <span className="decision-pill">{event.status}</span>
                  <time dateTime={event.timestamp}>{formatDate(event.timestamp)}</time>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Exposure Intelligence</h2>
            <span>Portfolio limits</span>
          </div>
          <div className="exposure-stack">
            <ExposureBar label="Gross Exposure" value={risk.summary.grossExposure} tone={risk.summary.grossExposure > 100 ? 'warning' : 'positive'} />
            <ExposureBar label="Net Exposure" value={risk.summary.netExposure} tone={Math.abs(risk.summary.netExposure) > 80 ? 'warning' : 'positive'} />
            <ExposureBar label="Concentration" value={risk.summary.concentrationRisk} tone={risk.summary.concentrationRisk > 25 ? 'danger' : 'positive'} />
            <ExposureBar label="Open Risk" value={risk.summary.openRiskPct} tone={risk.summary.openRiskPct > 2.5 ? 'danger' : 'positive'} />
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Risk Factors</h2>
            <span>Weighted portfolio profile</span>
          </div>
          <div className="metric-grid">
            <MetricCard label="Leverage" value={`${formatNumber(risk.summary.leverage)}x`} />
            <MetricCard label="Portfolio VaR" value={formatPercent(risk.summary.portfolioVar)} />
            <MetricCard label="Volatility" value={formatPercent(risk.summary.weightedVolatility)} />
            <MetricCard label="Liquidity" value={formatNumber(risk.summary.weightedLiquidityScore)} />
            <MetricCard label="Beta" value={formatNumber(risk.summary.portfolioBeta)} />
            <MetricCard label="Drawdown" value={formatPercent(risk.summary.drawdownPct)} />
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Asset Allocation</h2>
            <span>Asset-agnostic model</span>
          </div>
          <div className="allocation-list">
            {risk.assetExposure.map((asset) => (
              <div key={asset.assetType} className="allocation-row">
                <div>
                  <strong>{asset.assetType}</strong>
                  <span>{asset.count} position{asset.count === 1 ? '' : 's'}</span>
                </div>
                <div>
                  <strong>{formatPercent(asset.weight)}</strong>
                  <span>{formatCurrency(asset.marketValue)}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Warnings</h2>
            <span>Risk controls</span>
          </div>
          {risk.warnings.length > 0 ? (
            <ul className="warning-list">
              {risk.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : (
            <p className="empty-state">No active portfolio risk warnings.</p>
          )}
          <div className="recommendations">
            <h3>Recommendations</h3>
            <ul>
              {risk.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
            </ul>
          </div>
        </article>
        </Suspense>
      </WorkspaceLayout>

      <section className="panel positions-panel">
        <div className="panel-heading">
          <h2>Position Risk</h2>
          <span>No live orders. Paper risk review only.</span>
        </div>
        <div className="table-wrap">
          <table>
            <caption>Asset-agnostic position risk table</caption>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Asset</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Current</th>
                <th>Market Value</th>
                <th>Weight</th>
                <th>Open Risk</th>
                <th>Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {risk.positions.map((position) => (
                <tr key={`${position.symbol}-${position.assetType}`}>
                  <td><strong>{position.symbol}</strong></td>
                  <td>{position.assetType}</td>
                  <td className={position.side === 'short' ? 'negative' : 'positive'}>{position.side}</td>
                  <td>{formatNumber(position.quantity)} {position.quantityLabel}</td>
                  <td>{formatCurrency(position.currentPrice)}</td>
                  <td>{formatCurrency(position.absoluteMarketValue)}</td>
                  <td>{formatPercent(position.weight)}</td>
                  <td>{formatCurrency(position.dollarRisk)}</td>
                  <td>{formatNumber(position.liquidityScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
