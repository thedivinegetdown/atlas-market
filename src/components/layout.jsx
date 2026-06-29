function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

function StatusPill({ label, tone = 'neutral' }) {
  return <span className={`status-pill ${tone}`}>{label}</span>
}

export function PanelContainer({
  id,
  title,
  subtitle,
  children,
  size = 'standard',
  minWidth = 280,
}) {
  return (
    <section
      id={id}
      className={`panel-container panel-${size}`}
      style={{ '--panel-min-width': `${minWidth}px` }}
    >
      <div className="panel-container-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <div className="panel-scroll">{children}</div>
    </section>
  )
}

export function Sidebar({ items = [], activeItem = 'Dashboard', onNavigate, summary }) {
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-logo">
        <div className="logo-mark" aria-hidden="true">AM</div>
        <div>
          <strong>Atlas Market</strong>
          <span>Paper Trading Desk</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Primary workspace">
        {items.map((item) => {
          const active = activeItem === item.label
          return (
            <a
              key={item.label}
              href={item.href}
              className={active ? 'sidebar-link active' : 'sidebar-link'}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate?.(item.label)}
            >
              <span>{item.label}</span>
            </a>
          )
        })}
      </nav>

      <div className="sidebar-account" aria-label="Account summary">
        <span>Account Value</span>
        <strong>{formatCurrency(summary?.accountValue)}</strong>
        <div>
          <span>Cash {formatCurrency(summary?.cash)}</span>
          <span>Risk {Number(summary?.riskPct ?? 0).toFixed(1)}%</span>
        </div>
      </div>
    </aside>
  )
}

export function TopNavigation({
  selectedSymbol,
  marketStatus,
  connectionStatus,
  accountValue,
  isRefreshing = false,
  onRefresh,
}) {
  return (
    <header className="top-navigation">
      <div className="top-logo-area">
        <span className="terminal-dot" aria-hidden="true" />
        <div>
          <p>Institutional Trading Workspace</p>
          <strong>{selectedSymbol ?? 'SPY'}</strong>
        </div>
      </div>

      <div className="top-status-strip" aria-label="Workspace status">
        <StatusPill label={marketStatus?.label ?? 'Market Status'} tone={marketStatus?.tone} />
        <StatusPill label={connectionStatus ?? 'Connected'} tone="positive" />
        <span className="account-value">{formatCurrency(accountValue)}</span>
        <span className="paper-badge">Paper Trading</span>
      </div>

      <div className="top-actions">
        <button type="button" className="refresh-button" onClick={onRefresh}>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        <details className="settings-menu">
          <summary aria-label="Open settings menu">Settings</summary>
          <div>
            <a href="#settings">Workspace Density</a>
            <a href="#settings">Risk Preferences</a>
            <a href="#settings">Data Providers</a>
          </div>
        </details>
      </div>
    </header>
  )
}

export function Workspace({ children }) {
  return (
    <main className="workspace" aria-label="Dashboard workspace">
      {children}
    </main>
  )
}

export function DashboardLayout({ sidebar, topNav, main }) {
  return (
    <div className="dashboard-layout">
      {sidebar}
      <div className="dashboard-frame">
        {topNav}
        {main}
      </div>
    </div>
  )
}
