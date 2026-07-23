import { DiagnosticsPanel, MarketOverviewPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function MarketSections() {
  return (
    <>
      <WorkspacePanel id="market-data" title="Market Data" subtitle="Quote and selected symbol context">
        <MarketOverviewPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="streaming" title="Streaming" subtitle="Provider and routing health">
        <div className="metric-grid">
          <MetricCard label="Streaming" value="mock-ready" />
          <MetricCard label="Provider Health" value="diagnostics" />
          <MetricCard label="Market Regime" value="review" />
          <MetricCard label="Research Score" value="advisory" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="provider-health" title="Provider Health" subtitle="Runtime diagnostics">
        <DiagnosticsPanel />
      </WorkspacePanel>
      <WorkspacePanel id="scanner-status" title="Scanner Status" subtitle="Market data scanner readiness">
        <EmptyWorkspaceState>Scanner health remains advisory and paper-mode only.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
