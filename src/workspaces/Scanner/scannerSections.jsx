import { AlertsPanel, ScannerPanel, SignalPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function ScannerSections() {
  return (
    <>
      <WorkspacePanel id="signal-panel" title="Signal Panel" subtitle="Selected symbol signal context">
        <SignalPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="scanner" title="Scanner" subtitle="Configured scans and matches">
        <ScannerPanel />
      </WorkspacePanel>
      <WorkspacePanel id="alerts" title="Alerts" subtitle="Opportunity alert rules">
        <AlertsPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="opportunity-ranking" title="Opportunity Ranking" subtitle="Advisory ranking context">
        <div className="metric-grid">
          <MetricCard label="Candidates" value="scanner driven" />
          <MetricCard label="Ranking" value="advisory only" />
          <MetricCard label="Review" value="human gated" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="opportunity-review" title="Opportunity Review" subtitle="Safe review state">
        <EmptyWorkspaceState>No live trading actions are available from scanner opportunities.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
