import { DecisionPanel, PositionsPanel, RiskPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function RiskSections() {
  return (
    <>
      <WorkspacePanel id="risk-panel" title="Risk Panel" subtitle="Trade and portfolio risk">
        <RiskPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="trade-guardrails" title="Trade Guardrails" subtitle="Paper decision constraints">
        <DecisionPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="position-sizing" title="Position Sizing" subtitle="Sizing review">
        <div className="metric-grid">
          <MetricCard label="Sizing" value="advisory" />
          <MetricCard label="Risk Metrics" value="paper only" />
          <MetricCard label="Open Risk" value="review" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="open-risk" title="Open Risk" subtitle="Position risk table">
        <PositionsPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="risk-reports" title="Risk Reports" subtitle="Operator review">
        <EmptyWorkspaceState>Risk reports remain non-executing paper-trading summaries.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
