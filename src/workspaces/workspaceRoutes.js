export const workspaceRoutes = [
  { path: '/dashboard', aliases: ['/'], page: 'dashboard', label: 'Dashboard', icon: 'D', description: 'Executive overview' },
  { path: '/markets', page: 'markets', label: 'Markets', icon: 'M', description: 'Data and regimes' },
  { path: '/scanner', page: 'scanner', label: 'Scanner', icon: 'S', description: 'Signals and alerts' },
  { path: '/watchlist', page: 'watchlist', label: 'Watchlist', icon: 'W', description: 'Top symbols' },
  { path: '/portfolio', page: 'portfolio', label: 'Portfolio', icon: 'P', description: 'Positions and analytics' },
  { path: '/risk', page: 'risk', label: 'Risk', icon: 'R', description: 'Guardrails and sizing' },
  { path: '/orders', page: 'orders', label: 'Orders (Paper)', icon: 'O', description: 'Paper execution only' },
  { path: '/strategies', page: 'strategies', label: 'Strategies', icon: 'Y', description: 'Rules and lifecycle' },
  { path: '/backtesting', page: 'backtesting', label: 'Backtesting', icon: 'B', description: 'Replay and simulation' },
  { path: '/research', page: 'research', label: 'Research', icon: 'Q', description: 'Research intelligence' },
  { path: '/copilot', page: 'copilot', label: 'Atlas Copilot', icon: 'A', description: 'Safe AI advisory' },
  { path: '/reports', page: 'reports', label: 'Reports', icon: 'E', description: 'Audit and exports' },
  { path: '/health', page: 'health', label: 'System Health', icon: 'H', description: 'Runtime and release' },
  { path: '/settings', page: 'settings', label: 'Settings', icon: 'G', description: 'Workspace configuration' },
]

export const defaultWorkspaceRoute = workspaceRoutes[0]

export function getWorkspaceRoute(pathname = '/') {
  return workspaceRoutes.find((route) => route.path === pathname || route.aliases?.includes(pathname)) ?? defaultWorkspaceRoute
}
