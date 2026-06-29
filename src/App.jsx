import { useMemo, useState } from 'react'
import './App.css'
import {
  DashboardLayout,
  PanelContainer,
  Sidebar,
  TopNavigation,
  Workspace,
} from './components/layout.jsx'
import {
  JournalSummaryPanel,
  OrderEntryPanel,
  OrdersPanel,
  PortfolioSummaryPanel,
  PositionsPanel,
  RiskPanel,
  SignalPanel,
  SymbolOverviewPanel,
  WatchlistPanel,
} from './components/panels.jsx'
import { useOrders } from './hooks/useOrders.js'
import { usePortfolio } from './hooks/usePortfolio.js'
import { useRisk } from './hooks/useRisk.js'
import { useSignals } from './hooks/useSignals.js'
import { useWatchlist } from './hooks/useWatchlist.js'

const navigationItems = [
  { label: 'Dashboard', href: '#dashboard' },
  { label: 'Watchlist', href: '#watchlist' },
  { label: 'Portfolio', href: '#portfolio' },
  { label: 'Orders', href: '#orders' },
  { label: 'Positions', href: '#positions' },
  { label: 'Journal', href: '#journal' },
  { label: 'Analytics', href: '#analytics' },
  { label: 'Settings', href: '#settings' },
]

function getMarketStatus(date = new Date()) {
  const day = date.getDay()
  const minutes = date.getHours() * 60 + date.getMinutes()
  const regularOpen = 9 * 60 + 30
  const regularClose = 16 * 60

  if (day === 0 || day === 6) {
    return { label: 'Market Closed', tone: 'neutral' }
  }

  if (minutes >= regularOpen && minutes < regularClose) {
    return { label: 'Market Open', tone: 'positive' }
  }

  return { label: 'After Hours', tone: 'warning' }
}

function App() {
  const watchlist = useWatchlist()
  const portfolio = usePortfolio()
  const orders = useOrders()
  const signals = useSignals(watchlist.selectedQuote)
  const risk = useRisk({
    portfolio: portfolio.portfolio,
    quote: watchlist.selectedQuote,
  })
  const [activeItem, setActiveItem] = useState('Dashboard')

  const marketStatus = useMemo(() => getMarketStatus(), [])
  const connectionStatus = watchlist.selectedQuote?.health?.available
    ? `Connected: ${watchlist.selectedQuote.health.provider}`
    : 'Connected: mock'

  const refreshWorkspace = () => {
    void watchlist.refresh()
    portfolio.refresh()
    orders.refresh()
    risk.refresh()
  }

  return (
    <DashboardLayout
      sidebar={
        <Sidebar
          items={navigationItems}
          activeItem={activeItem}
          onNavigate={setActiveItem}
          summary={portfolio.summary}
        />
      }
      topNav={
        <TopNavigation
          selectedSymbol={watchlist.selectedSymbol}
          marketStatus={marketStatus}
          connectionStatus={connectionStatus}
          accountValue={portfolio.summary.accountValue}
          isRefreshing={watchlist.isRefreshing}
          onRefresh={refreshWorkspace}
        />
      }
      main={
        <Workspace>
          <PanelContainer id="watchlist" title="Watchlist" size="wide">
            <WatchlistPanel
              quotes={watchlist.quotes}
              selectedSymbol={watchlist.selectedSymbol}
              onSelectSymbol={watchlist.setSelectedSymbol}
              refreshing={watchlist.isRefreshing}
              onRefresh={watchlist.refresh}
            />
          </PanelContainer>
          <PanelContainer title="Symbol" minWidth={300}>
            <SymbolOverviewPanel quote={watchlist.selectedQuote} />
          </PanelContainer>
          <PanelContainer title="Signal">
            <SignalPanel signal={signals.signal} />
          </PanelContainer>
          <PanelContainer title="Risk">
            <RiskPanel risk={risk.risk} />
          </PanelContainer>
          <PanelContainer title="Order Entry" minWidth={320}>
            <OrderEntryPanel portfolio={portfolio.portfolio} quote={watchlist.selectedQuote} />
          </PanelContainer>
          <PanelContainer id="portfolio" title="Portfolio" size="wide">
            <PortfolioSummaryPanel summary={portfolio.summary} />
          </PanelContainer>
          <PanelContainer id="orders" title="Orders" size="wide">
            <OrdersPanel orders={orders.orders} onCancelOrder={orders.cancelOrder} onRefresh={orders.refresh} />
          </PanelContainer>
          <PanelContainer id="positions" title="Positions" size="full">
            <PositionsPanel positions={portfolio.summary.openPositions} />
          </PanelContainer>
          <PanelContainer id="journal" title="Journal" size="full">
            <JournalSummaryPanel />
          </PanelContainer>
        </Workspace>
      }
    />
  )
}

export default App
