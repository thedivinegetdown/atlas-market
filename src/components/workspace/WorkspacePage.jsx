export function MetricCard({ label, value, tone = '' }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

export function WorkspacePage({ eyebrow = 'Atlas Market', title, description, children }) {
  return (
    <div className="workspace-page">
      <header className="risk-header page-intro">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="header-copy">{description}</p>
          <p className="workspace-line">
            Advisory paper-trading workspace only. No live orders, broker execution, API contract changes, risk calculation changes, or AI behavior changes.
          </p>
        </div>
        <div className="header-status" aria-label={`${title} workspace status`}>
          <span className="paper-pill">Paper Trading only</span>
        </div>
      </header>
      <section className="dashboard-grid workspace-route-grid">
        {children}
      </section>
    </div>
  )
}

export function WorkspacePanel({ id, title, subtitle, children, className = '' }) {
  return (
    <article id={id} className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {children}
    </article>
  )
}

export function EmptyWorkspaceState({ children }) {
  return <p className="empty-state">{children}</p>
}
