import { EquityCurvePanel, PositionsPanel, PortfolioSummaryPanel } from '../../components/panels.jsx'
import { MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function PortfolioSections({ overview }) {
  return (
    <>
      <WorkspacePanel id="portfolio-summary" title="Portfolio Summary" subtitle="Paper account and P&L">
        <PortfolioSummaryPanel />
      </WorkspacePanel>
      <WorkspacePanel id="positions" title="Positions" subtitle="Open paper positions">
        <PositionsPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="performance" title="Performance" subtitle="Equity curve">
        <EquityCurvePanel />
      </WorkspacePanel>
      <WorkspacePanel id="analytics" title="Analytics" subtitle="Portfolio intelligence">
        <div className="metric-grid">
          <MetricCard label="Performance" value={overview.performance} />
          <MetricCard label="Analytics" value={overview.analytics} />
          <MetricCard label="Capital Allocation" value={overview.allocation} />
          <MetricCard label="Diversification" value={overview.diversification} />
        </div>
      </WorkspacePanel>
    </>
  )
}
