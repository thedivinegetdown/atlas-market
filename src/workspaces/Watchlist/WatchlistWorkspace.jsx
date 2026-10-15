import { MarketOverviewPanel, SignalPanel, WatchlistPanel } from '../../components/panels.jsx'
import { WorkspacePage, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useWatchlist } from '../../hooks/useWatchlist.js'
import { useNavigate } from 'react-router-dom'

export default function WatchlistWorkspace() {
  const watchlist = useWatchlist()
  const navigate = useNavigate()

  const openResearch = (symbol) => {
    watchlist.setSelectedSymbol(symbol)
    navigate(`/research/${encodeURIComponent(symbol)}`)
  }

  return (
    <WorkspacePage title="Watchlist" description="Focused watchlist, selected market overview, and paper signal context.">
      <WorkspacePanel id="watchlist" title="Watchlist" subtitle="Tracked instruments">
        <WatchlistPanel
          quotes={watchlist.quotes}
          selectedSymbol={watchlist.selectedSymbol}
          onSelectSymbol={watchlist.setSelectedSymbol}
          onOpenSymbol={openResearch}
          refreshing={watchlist.isRefreshing}
          loading={watchlist.isLoading}
          error={watchlist.error}
          onRefresh={watchlist.refresh}
          autoLoad={false}
        />
      </WorkspacePanel>
      <WorkspacePanel id="watchlist-market-overview" title="Market Overview" subtitle="Selected symbol">
        <MarketOverviewPanel
          symbol={watchlist.selectedSymbol}
          quote={watchlist.selectedQuote}
          loading={watchlist.isLoading}
          error={watchlist.error}
          enabled={Boolean(watchlist.selectedQuote)}
        />
      </WorkspacePanel>
      <WorkspacePanel id="watchlist-signal" title="Signal Panel" subtitle="Advisory signal">
        <SignalPanel symbol="SPY" />
      </WorkspacePanel>
    </WorkspacePage>
  )
}
