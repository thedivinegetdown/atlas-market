import { useMemo } from 'react'
import './App.css'
import { applyPaperPortfolioAccounting } from './core/accounting/paperPortfolioAccountingEngine.js'
import { evaluatePaperPerformance } from './core/analytics/paperPerformanceAnalyticsEngine.js'
import { simulateTradeExecution } from './core/execution/executionSimulationEngine.js'
import { recordPaperTradeJournal } from './core/journal/paperTradeJournalEngine.js'
import { evaluatePortfolioRisk } from './core/risk/portfolioRiskEngine.js'
import { evaluateTradeGuardrail } from './core/risk/tradeGuardrailEngine.js'
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

function App() {
  const risk = useMemo(() => evaluatePortfolioRisk(demoPortfolio, { emitEvent: false }), [])
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
  const primaryAccounting = accountingUpdates[0]?.result
  const riskTone = getRiskTone(risk.summary.riskLevel)

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

      <section className="dashboard-grid">
        <article className="panel guardrail-panel">
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

        <article className="panel execution-panel">
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

        <article className="panel accounting-panel">
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

        <article className="panel journal-panel">
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

        <article className="panel performance-panel">
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
      </section>

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
