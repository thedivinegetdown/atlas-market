import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function ReportSections() {
  return (
    <>
      <WorkspacePanel id="paper-reports" title="Paper Reports" subtitle="Reporting outputs">
        <div className="metric-grid">
          <MetricCard label="Audit" value="available" />
          <MetricCard label="Exports" value="CSV / JSON" />
          <MetricCard label="History" value="paper mode" />
          <MetricCard label="Operator Reports" value="review" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="exports" title="Exports" subtitle="CSV and JSON">
        <EmptyWorkspaceState>Exports remain report artifacts only and do not change trading state.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
