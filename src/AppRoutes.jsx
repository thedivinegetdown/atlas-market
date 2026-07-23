import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { WorkspaceLayout } from './components/WorkspaceLayout.jsx'

const DashboardWorkspace = lazy(() => import('./workspaces/Dashboard/index.jsx'))
const MarketsWorkspace = lazy(() => import('./workspaces/Markets/index.jsx'))
const ScannerWorkspace = lazy(() => import('./workspaces/Scanner/index.jsx'))
const WatchlistWorkspace = lazy(() => import('./workspaces/Watchlist/index.jsx'))
const PortfolioWorkspace = lazy(() => import('./workspaces/Portfolio/index.jsx'))
const RiskWorkspace = lazy(() => import('./workspaces/Risk/index.jsx'))
const OrdersWorkspace = lazy(() => import('./workspaces/Orders/index.jsx'))
const StrategiesWorkspace = lazy(() => import('./workspaces/Strategies/index.jsx'))
const BacktestingWorkspace = lazy(() => import('./workspaces/Backtesting/index.jsx'))
const ResearchWorkspace = lazy(() => import('./workspaces/Research/index.jsx'))
const AtlasCopilotWorkspace = lazy(() => import('./workspaces/AtlasCopilot/index.jsx'))
const ReportsWorkspace = lazy(() => import('./workspaces/Reports/index.jsx'))
const SystemHealthWorkspace = lazy(() => import('./workspaces/SystemHealth/index.jsx'))
const SettingsWorkspace = lazy(() => import('./workspaces/Settings/index.jsx'))

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<WorkspaceLayout />}>
        <Route index element={<DashboardWorkspace />} />
        <Route path="dashboard" element={<DashboardWorkspace />} />
        <Route path="markets" element={<MarketsWorkspace />} />
        <Route path="scanner" element={<ScannerWorkspace />} />
        <Route path="watchlist" element={<WatchlistWorkspace />} />
        <Route path="portfolio" element={<PortfolioWorkspace />} />
        <Route path="risk" element={<RiskWorkspace />} />
        <Route path="orders" element={<OrdersWorkspace />} />
        <Route path="strategies" element={<StrategiesWorkspace />} />
        <Route path="backtesting" element={<BacktestingWorkspace />} />
        <Route path="research" element={<ResearchWorkspace />} />
        <Route path="copilot" element={<AtlasCopilotWorkspace />} />
        <Route path="reports" element={<ReportsWorkspace />} />
        <Route path="health" element={<SystemHealthWorkspace />} />
        <Route path="settings" element={<SettingsWorkspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default AppRoutes
