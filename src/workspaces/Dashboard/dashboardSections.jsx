import { AlertsPanel, DiagnosticsPanel, MarketOverviewPanel, PortfolioSummaryPanel, WatchlistPanel } from '../../components/panels.jsx'
import { MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function DashboardSections({ summary }) {
  return (
    <>
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
