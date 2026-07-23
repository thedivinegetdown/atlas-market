import { lazy } from 'react'
import { DiagnosticsPanel } from '../../components/panels.jsx'
import { LazyFeature } from '../../components/LazyFeatureBoundary.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

const ReleaseDiagnosticsPanel = lazy(() => import('../../components/ReleaseDiagnosticsPanel.jsx').then((module) => ({
  default: module.ReleaseDiagnosticsPanel,
})))

export function HealthSections() {
  return (
    <>
      <WorkspacePanel id="runtime-health" title="Runtime Health" subtitle="API and workspace diagnostics">
        <DiagnosticsPanel />
      </WorkspacePanel>
      <LazyFeature label="Release Diagnostics">
        <ReleaseDiagnosticsPanel />
      </LazyFeature>
      <WorkspacePanel id="observability" title="Observability" subtitle="Deployment and environment">
        <div className="metric-grid">
          <MetricCard label="Release Readiness" value="review" />
          <MetricCard label="Deployment" value="operator gated" />
          <MetricCard label="Environment" value="diagnostics" />
          <MetricCard label="Release Candidate" value="paper mode" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="system-boundary" title="System Boundary" subtitle="No runtime contract changes">
        <EmptyWorkspaceState>System health panels do not modify APIs, persistence, release logic, or event contracts.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
