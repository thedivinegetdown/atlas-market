import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function StrategySections() {
  return (
    <>
      <WorkspacePanel id="strategy-builder" title="Strategy Builder" subtitle="Blueprint presentation">
        <div className="metric-grid">
          <MetricCard label="Builder" value="available" />
          <MetricCard label="Rule Evaluation" value="advisory" />
          <MetricCard label="Signal Composer" value="paper context" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="strategy-lifecycle" title="Lifecycle" subtitle="Human-reviewed lifecycle">
        <EmptyWorkspaceState>Strategy lifecycle changes remain presentation-only in this workspace.</EmptyWorkspaceState>
      </WorkspacePanel>
      <WorkspacePanel id="strategy-registry" title="Registry" subtitle="Strategy library">
        <EmptyWorkspaceState>Registry surfaces strategy metadata without executing trades.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
