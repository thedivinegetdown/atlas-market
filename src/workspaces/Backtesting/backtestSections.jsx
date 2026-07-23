import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function BacktestSections() {
  return (
    <>
      <WorkspacePanel id="historical-replay" title="Replay" subtitle="Historical replay presentation">
        <div className="metric-grid">
          <MetricCard label="Replay" value="prepared" />
          <MetricCard label="Backtesting" value="simulated" />
          <MetricCard label="Performance" value="review" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="walk-forward" title="Walk Forward" subtitle="Robustness review">
        <EmptyWorkspaceState>Walk-forward results are advisory and do not place trades.</EmptyWorkspaceState>
      </WorkspacePanel>
      <WorkspacePanel id="monte-carlo" title="Monte Carlo" subtitle="Scenario analysis">
        <EmptyWorkspaceState>Monte Carlo simulations remain presentation-only risk research.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
