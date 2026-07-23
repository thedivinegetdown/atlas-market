import { MarketOverviewPanel, SignalPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function ResearchSections() {
  return (
    <>
      <WorkspacePanel id="research-intelligence" title="Research Intelligence" subtitle="Market and research context">
        <MarketOverviewPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="research-score" title="Research Score" subtitle="Signal and context score">
        <SignalPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="multi-timeframe-research" title="Multi-Timeframe Research" subtitle="Timeframe alignment">
        <div className="metric-grid">
          <MetricCard label="Research Context" value="advisory" />
          <MetricCard label="Market Intelligence" value="review" />
          <MetricCard label="Research Decision" value="human gated" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="research-ai" title="Research AI" subtitle="Safe advisory">
        <EmptyWorkspaceState>Research AI context is advisory only and cannot submit orders.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
