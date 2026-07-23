import { EmptyWorkspaceState, MetricCard, WorkspacePage, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export default function SettingsWorkspace() {
  return (
    <WorkspacePage title="Settings" description="Workspace, preferences, theme, paper trading settings, mock providers, and configuration.">
      <WorkspacePanel id="workspace-preferences" title="Workspace" subtitle="Preferences and theme">
        <div className="metric-grid">
          <MetricCard label="Theme" value="system" />
          <MetricCard label="Density" value="operator" />
          <MetricCard label="Paper Trading" value="enabled" />
          <MetricCard label="Mock Providers" value="enabled" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="configuration" title="Configuration" subtitle="Safe local configuration">
        <EmptyWorkspaceState>Settings are presentation-only in this refactor and do not alter persistence, auth, tenant isolation, or provider contracts.</EmptyWorkspaceState>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
