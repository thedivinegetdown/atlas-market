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
  DiagnosticsPanel,
  AlertsPanel,
  ScannerPanel,
  DecisionPanel,
  OrderEntryPanel,
  OrdersPanel,
  EquityCurvePanel,
  PortfolioSummaryPanel,
  PositionsPanel,
  RiskPanel,
  SignalPanel,
  MarketOverviewPanel,
  WatchlistPanel,
} from './components/panels.jsx'
import { useMarketOverview } from './hooks/useMarketOverview.js'
import { useOrders } from './hooks/useOrders.js'
import { usePositions } from './hooks/usePositions.js'
import { usePortfolio } from './hooks/usePortfolio.js'
import { usePortfolioAnalytics } from './hooks/usePortfolioAnalytics.js'
import { useEquityCurve } from './hooks/useEquityCurve.js'
import { useRisk } from './hooks/useRisk.js'
import { useDecision } from './hooks/useDecision.js'
import { useSignals } from './hooks/useSignals.js'
import { useSystemHealth } from './hooks/useSystemHealth.js'
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
  const marketOverview = useMarketOverview({
    symbol: watchlist.selectedSymbol,
    initialQuote: watchlist.selectedQuote,
  })
  const portfolio = usePortfolio()
  const portfolioAnalytics = usePortfolioAnalytics()
  const equityCurve = useEquityCurve()
  const orders = useOrders()
  const activeQuote = marketOverview.quote ?? watchlist.selectedQuote
  const positions = usePositions({
    quotes: watchlist.quotes,
    activeQuote,
    accountValue: portfolioAnalytics.summary.accountValue,
  })
  const signals = useSignals(activeQuote)
  const systemHealth = useSystemHealth()
  const risk = useRisk({
    portfolio: portfolio.portfolio,
    accountSummary: portfolioAnalytics.summary,
    quote: activeQuote,
  })
  const decision = useDecision(watchlist.selectedSymbol)
  const [activeItem, setActiveItem] = useState('Dashboard')
  const [journalRefreshKey, setJournalRefreshKey] = useState(0)

  const marketStatus = useMemo(() => getMarketStatus(), [])
  const connectionStatus = activeQuote?.health?.available
    ? `Connected: ${activeQuote.health.provider}`
    : 'Connected: mock'

  const refreshWorkspace = () => {
    void watchlist.refresh()
    void marketOverview.refresh()
    portfolio.refresh()
    portfolioAnalytics.refresh()
    equityCurve.refresh()
    orders.refresh()
    positions.refresh()
    risk.refresh()
    decision.refresh()
  }

  const refreshExecutionPanels = () => {
    void orders.refresh()
    positions.refresh()
    portfolioAnalytics.refresh()
    equityCurve.refresh()
    setJournalRefreshKey((value) => value + 1)
  }

  return (
    <DashboardLayout
      sidebar={
        <Sidebar
          items={navigationItems}
          activeItem={activeItem}
          onNavigate={setActiveItem}
          summary={portfolioAnalytics.summary}
        />
      }
      topNav={
        <TopNavigation
          selectedSymbol={watchlist.selectedSymbol}
          marketStatus={marketStatus}
          connectionStatus={connectionStatus}
          accountValue={portfolioAnalytics.summary.accountValue}
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
          <PanelContainer title="Market Overview" minWidth={300}>
            <MarketOverviewPanel
              symbol={watchlist.selectedSymbol}
              quote={activeQuote}
              loading={marketOverview.isLoading}
              refreshing={marketOverview.isRefreshing}
              error={marketOverview.error}
              onRefresh={marketOverview.refresh}
            />
          </PanelContainer>
          <PanelContainer title="Signal">
            <SignalPanel
              signal={signals.signal}
              symbol={watchlist.selectedSymbol}
              loading={signals.isLoading}
              refreshing={signals.isRefreshing}
              error={signals.error}
              onRefresh={signals.refresh}
            />
          </PanelContainer>
          <PanelContainer title="Risk">
            <RiskPanel
              risk={risk.risk}
              symbol={watchlist.selectedSymbol}
              loading={risk.isLoading}
              refreshing={risk.isRefreshing}
              error={risk.error}
              onRefresh={risk.refresh}
            />
          </PanelContainer>
          <PanelContainer title="Decision Intelligence" size="wide">
            <DecisionPanel
              decision={decision.decision}
              assetProfile={decision.assetProfile}
              symbol={watchlist.selectedSymbol}
              loading={decision.isLoading}
              refreshing={decision.isRefreshing}
              error={decision.error}
              onRefresh={decision.refresh}
            />
          </PanelContainer>
          <PanelContainer title="Order Entry" minWidth={320}>
            <OrderEntryPanel
              portfolio={portfolio.portfolio}
              quote={activeQuote}
              onMutationSuccess={refreshExecutionPanels}
            />
          </PanelContainer>
          <PanelContainer id="portfolio" title="Portfolio" size="wide">
            <PortfolioSummaryPanel
              summary={portfolioAnalytics.summary}
              loading={portfolioAnalytics.isLoading}
              error={portfolioAnalytics.error}
            />
          </PanelContainer>
          <PanelContainer id="analytics" title="Equity Curve" size="wide">
            <EquityCurvePanel
              points={equityCurve.points}
              drawdowns={equityCurve.drawdowns}
              timeline={equityCurve.timeline}
              maxDrawdown={equityCurve.maxDrawdown}
              loading={equityCurve.isLoading}
              error={equityCurve.error}
            />
          </PanelContainer>
          <PanelContainer id="orders" title="Orders" size="wide">
            <OrdersPanel
              orders={orders.orders}
              activeSymbol={watchlist.selectedSymbol}
              onCancelOrder={orders.cancelOrder}
              onRefresh={orders.refresh}
              onMutationSuccess={refreshExecutionPanels}
            />
          </PanelContainer>
          <PanelContainer id="positions" title="Positions" size="full">
            <PositionsPanel
              positions={positions.positions}
              activeSymbol={watchlist.selectedSymbol}
              onRefresh={positions.refresh}
            />
          </PanelContainer>
          <PanelContainer id="journal" title="Journal" size="full">
            <JournalSummaryPanel key={journalRefreshKey} activeSymbol={watchlist.selectedSymbol} />
          </PanelContainer>
          <PanelContainer title="Alerts" size="full">
            <AlertsPanel activeSymbol={watchlist.selectedSymbol} />
          </PanelContainer>
          <PanelContainer title="Scanner" size="full">
            <ScannerPanel />
          </PanelContainer>
          <PanelContainer id="settings" title="Diagnostics" size="wide">
            <DiagnosticsPanel healthState={systemHealth} />
          </PanelContainer>
        </Workspace>
      }
    />
  )
}

export default App
