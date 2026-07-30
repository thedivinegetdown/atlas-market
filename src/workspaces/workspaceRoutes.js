export const workspaceRoutes = [
  { path: '/dashboard', aliases: ['/'], page: 'dashboard', label: 'Dashboard', icon: 'dashboard', description: 'Executive overview' },
  { path: '/markets', page: 'markets', label: 'Markets', icon: 'markets', description: 'Data and regimes' },
  { path: '/scanner', page: 'scanner', label: 'Scanner', icon: 'scanner', description: 'Signals and alerts' },
  { path: '/watchlist', page: 'watchlist', label: 'Watchlist', icon: 'watchlist', description: 'Top symbols' },
  { path: '/portfolio', page: 'portfolio', label: 'Portfolio', icon: 'portfolio', description: 'Positions and analytics' },
  { path: '/risk', page: 'risk', label: 'Risk', icon: 'risk', description: 'Guardrails and sizing' },
  { path: '/orders', page: 'orders', label: 'Orders (Paper)', icon: 'orders', description: 'Paper execution only' },
  { path: '/strategies', page: 'strategies', label: 'Strategies', icon: 'strategies', description: 'Rules and lifecycle' },
  { path: '/backtesting', page: 'backtesting', label: 'Backtesting', icon: 'backtesting', description: 'Replay and simulation' },
  { path: '/research', page: 'research', label: 'Research', icon: 'research', description: 'Research intelligence' },
  { path: '/copilot', page: 'copilot', label: 'Atlas Copilot', icon: 'copilot', description: 'Safe AI advisory' },
  { path: '/reports', page: 'reports', label: 'Reports', icon: 'reports', description: 'Audit and exports' },
  { path: '/health', page: 'health', label: 'System Health', icon: 'health', description: 'Runtime and release' },
  { path: '/settings', page: 'settings', label: 'Settings', icon: 'settings', description: 'Workspace configuration' },
]

export const defaultWorkspaceRoute = workspaceRoutes[0]

export function getWorkspaceRoute(pathname = '/') {
  return workspaceRoutes.find((route) => route.path === pathname || route.aliases?.includes(pathname)) ?? defaultWorkspaceRoute
}
