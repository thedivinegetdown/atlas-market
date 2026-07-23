import { JournalSummaryPanel, OrderEntryPanel, OrdersPanel } from '../../components/panels.jsx'
import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export function OrderSections() {
  return (
    <>
      <WorkspacePanel id="paper-order-entry" title="Execution Simulation" subtitle="Paper order entry only">
        <OrderEntryPanel />
      </WorkspacePanel>
      <WorkspacePanel id="order-status" title="Order Status" subtitle="Paper orders">
        <OrdersPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="accounting" title="Accounting" subtitle="Paper accounting context">
        <div className="metric-grid">
          <MetricCard label="Accounting" value="paper ledger" />
          <MetricCard label="Lifecycle" value="simulated" />
          <MetricCard label="Live Trading" value="disabled" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="trade-journal" title="Trade Journal" subtitle="Paper journal">
        <JournalSummaryPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="live-trading-boundary" title="No Live Trading" subtitle="Safety boundary">
        <EmptyWorkspaceState>No live trading, brokerage execution, or broker order routing is available.</EmptyWorkspaceState>
      </WorkspacePanel>
    </>
  )
}
