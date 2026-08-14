import { AlertsPanel, DiagnosticsPanel, MarketOverviewPanel, PortfolioSummaryPanel, WatchlistPanel } from '../../components/panels.jsx'
import { MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useDailyBriefing } from '../../hooks/useDailyBriefing.js'
import { MarketDataStatus } from '../../components/MarketDataStatus.jsx'

function display(value) { return String(value ?? 'UNKNOWN').replaceAll('_', ' ') }

export function DailyBriefingPanel({ state } = {}) {
  const liveState = useDailyBriefing({ enabled: !state })
  const resolved = state ?? liveState
  const briefing = resolved.briefing
  if (resolved.isLoading && !briefing) return <WorkspacePanel id="daily-briefing" title="Atlas Daily Briefing" subtitle="Command Center intelligence"><p role="status">Loading daily briefing…</p></WorkspacePanel>
  if (resolved.error && !briefing) return <WorkspacePanel id="daily-briefing" title="Atlas Daily Briefing" subtitle="Command Center intelligence"><p role="alert">Daily briefing is unavailable.</p></WorkspacePanel>
  if (!briefing) return <WorkspacePanel id="daily-briefing" title="Atlas Daily Briefing" subtitle="Command Center intelligence"><p role="status">Briefing evidence is insufficient.</p></WorkspacePanel>
  return <WorkspacePanel id="daily-briefing" title="Atlas Daily Briefing" subtitle={`${display(briefing.status)} · ${briefing.asOf ? new Date(briefing.asOf).toLocaleString() : 'As-of time unavailable'}`}>
    <MarketDataStatus provenance={briefing.market?.marketData} />
    <div className="metric-grid">
      <MetricCard label="Briefing Status" value={display(briefing.status)} />
      <MetricCard label="Trend Regime" value={display(briefing.market?.trendRegime)} />
      <MetricCard label="Risk Regime" value={display(briefing.market?.riskRegime)} />
      <MetricCard label="Regime Confidence" value={`${briefing.market?.confidence ?? 0}%`} />
      <MetricCard label="Freshness" value={display(briefing.market?.freshness)} />
      <MetricCard label="Enabled Strategies" value={briefing.strategies?.enabled ?? 0} />
      <MetricCard label="Conditional Strategies" value={briefing.strategies?.conditional ?? 0} />
      <MetricCard label="Open Risk" value={briefing.portfolioRisk?.openRisk == null ? 'Unavailable' : `$${briefing.portfolioRisk.openRisk.toLocaleString()}`} />
      <MetricCard label="Max Drawdown" value={briefing.portfolioRisk?.drawdown == null ? 'Unavailable' : `${briefing.portfolioRisk.drawdown}%`} />
      <MetricCard label="Critical Alerts" value={briefing.operations?.criticalAlerts ?? 0} />
    </div>
    <div className="analytics-columns">
      <section><h3>Priority review</h3><ol>{briefing.priorities?.map((item) => <li key={item.id}><strong>{display(item.level)}: {item.title}</strong><p>{item.reason}</p></li>)}</ol></section>
      <section><h3>Opportunity review</h3>{briefing.opportunities?.length ? <ul>{briefing.opportunities.map((item) => <li key={item.opportunityId ?? `${item.symbol}-${item.strategyId}`}><strong>{item.symbol}: {item.score ?? 'Not scored'} · {display(item.band)}</strong><p>{item.strategyId} · {item.confidence}% confidence · {display(item.freshness)} · {display(item.reviewState)}</p><p>Paper Evaluation: {display(item.paperEvaluation?.status ?? 'NOT EVALUATED')} · Human review required</p><p>{item.reasons?.[0] ?? 'No deterministic reason available.'}{item.blockers?.length ? ` · ${item.blockers.length} blocker(s)` : ''}</p></li>)}</ul> : <p>No bounded reviewed opportunities are available.</p>}</section>
    </div>
    {briefing.warnings?.length ? <details><summary>Coverage and warnings</summary>{briefing.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details> : null}
    <p>Advisory only. Paper trading remains mandatory; the briefing cannot change scanner order, strategy lifecycle, portfolios, or risk controls.</p>
  </WorkspacePanel>
}

export function DashboardSections({ summary }) {
  return (
    <>
      <DailyBriefingPanel />
      <WorkspacePanel id="dashboard-summary" title="Portfolio Summary" subtitle="Executive overview">
        <div className="metric-grid">
          <MetricCard label="Account Value" value={summary.accountValue} />
          <MetricCard label="Risk Score" value={summary.riskScore} />
          <MetricCard label="Market Overview" value={summary.marketStatus} />
          <MetricCard label="System Health" value={summary.systemStatus} />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="portfolio-summary" title="Portfolio Summary" subtitle="Paper account snapshot">
        <PortfolioSummaryPanel />
      </WorkspacePanel>
      <WorkspacePanel id="market-overview" title="Market Overview" subtitle="Selected market context">
        <MarketOverviewPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="top-watchlist" title="Top Watchlist" subtitle="Tracked instruments">
        <WatchlistPanel />
      </WorkspacePanel>
      <WorkspacePanel id="open-alerts" title="Open Alerts" subtitle="Paper alert review">
        <AlertsPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="system-health" title="System Health" subtitle="Runtime diagnostics">
        <DiagnosticsPanel />
      </WorkspacePanel>
    </>
  )
}
