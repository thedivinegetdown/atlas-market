import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function BacktestSections() {
  return (
    <>
      <WorkspacePanel id="historical-replay" title="Replay" subtitle="Historical replay presentation">
        <div className="metric-grid">
          <MetricCard label="Replay" value="presentation only" />
          <MetricCard label="Backtesting" value="UNAVAILABLE" />
          <MetricCard label="Performance" value="UNAVAILABLE" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="walk-forward" title="Walk Forward" subtitle="Robustness review">
        <EmptyWorkspaceState>Walk-forward evidence is unavailable until independent historical test windows can be executed with verified data and strategy contracts.</EmptyWorkspaceState>
      </WorkspacePanel>
      <WorkspacePanel id="monte-carlo" title="Monte Carlo" subtitle="Scenario analysis">
        <EmptyWorkspaceState>Monte Carlo requires sufficient canonical completed paper outcomes. Resampling does not establish historical strategy validity.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
