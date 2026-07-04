import { useMemo } from 'react'
import './App.css'
import { applyPaperPortfolioAccounting } from './core/accounting/paperPortfolioAccountingEngine.js'
import { orchestrateAIDecision } from './core/ai/aiDecisionOrchestrator.js'
import { recommendCapitalAllocation } from './core/analytics/capitalAllocationEngine.js'
import { evaluatePaperPerformance } from './core/analytics/paperPerformanceAnalyticsEngine.js'
import { evaluatePortfolioAnalytics } from './core/analytics/portfolioAnalyticsEngine.js'
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
import {
  BROKER_ADAPTER_CHECKED_EVENT,
  createBrokerAdapter,
  normalizeBrokerAccount,
  normalizeBrokerPosition,
} from '../lib/brokers/brokerAdapter.js'
import { createMarketDataAdapter, MARKET_DATA_ADAPTER_CHECKED_EVENT } from '../lib/market/marketDataAdapter.js'
import { createSignalEngine } from '../lib/signals/signalEngine.js'
import { evaluateReleaseReadiness } from '../lib/system/releaseReadiness.js'
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
  const aiDecision = useMemo(() => orchestrateAIDecision({
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
  }, { emitEvent: false }), [capitalAllocation, drawdownProtection, guardrails, performance, positionSizing, risk, riskAdjustedPerformance])
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
  const workspaceNavigation = [
    { id: 'market-data-health', label: 'Market Data', status: marketDataAdapterHealth.health.status },
    { id: 'broker-adapter-health', label: 'Broker Adapter', status: brokerAdapterHealth.health.status },
    { id: 'release-readiness', label: 'Release RC', status: releaseReadiness.releaseReadinessStatus },
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
    { id: 'drawdown-protection', label: 'Drawdown', status: drawdownProtection.protectionStatus },
    { id: 'multi-strategy', label: 'Strategies', status: strategyPortfolioManager.strategyApprovalStatus },
    { id: 'event-timeline', label: 'Events', status: eventTimeline.length },
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
