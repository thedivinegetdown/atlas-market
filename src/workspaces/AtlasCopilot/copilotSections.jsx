import { lazy } from 'react'
import { LazyFeature } from '../../components/LazyFeatureBoundary.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

const AtlasCopilotPanel = lazy(() => import('../../components/AtlasCopilotPanel.jsx').then((module) => ({
  default: module.AtlasCopilotPanel,
})))

export function CopilotSections() {
  return (
    <>
      <LazyFeature label="Atlas Copilot">
        <AtlasCopilotPanel />
      </LazyFeature>
      <WorkspacePanel id="copilot-context" title="Context" subtitle="Safe advisory context">
        <div className="metric-grid">
          <MetricCard label="Portfolio Analysis" value="advisory" />
          <MetricCard label="Opportunity Review" value="human gated" />
          <MetricCard label="History" value="read only" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="safe-ai-advisory" title="Safe AI Advisory" subtitle="AI boundary">
        <EmptyWorkspaceState>Atlas Copilot cannot place orders, call brokers, or bypass paper-trading controls.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
