import { MarketOverviewPanel, SignalPanel, WatchlistPanel } from '../../components/panels.jsx'
import { WorkspacePage, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'

export default function WatchlistWorkspace() {
  return (
    <WorkspacePage title="Watchlist" description="Focused watchlist, selected market overview, and paper signal context.">
      <WorkspacePanel id="watchlist" title="Watchlist" subtitle="Tracked instruments">
        <WatchlistPanel />
      </WorkspacePanel>
      <WorkspacePanel id="watchlist-market-overview" title="Market Overview" subtitle="Selected symbol">
        <MarketOverviewPanel symbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="watchlist-signal" title="Signal Panel" subtitle="Advisory signal">
        <SignalPanel symbol="SPY" />
      </WorkspacePanel>
    </WorkspacePage>
  )
}
