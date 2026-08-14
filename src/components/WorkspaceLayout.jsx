import { Component, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { FeaturePanelFallback } from './LazyFeatureBoundary.jsx'
import { WorkspaceIcon } from './WorkspaceIcon.jsx'
import { getWorkspaceRoute, workspaceRoutes } from '../workspaces/workspaceRoutes.js'
import { useIdentityAuth } from '../auth/identityAuthContext.js'

function WorkspaceBreadcrumb({ activeRoute }) {
  return (
    <nav className="workspace-breadcrumb" aria-label="Breadcrumb">
      <NavLink to="/">Atlas Market</NavLink>
      <span>/</span>
      <strong>{activeRoute.label}</strong>
    </nav>
  )
}

class WorkspaceRouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidUpdate(previousProps) {
    if (previousProps.routeKey !== this.props.routeKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <article className="panel workspace-route-error" role="alert">
          <div className="panel-heading">
            <h2>Workspace unavailable</h2>
            <span>Safe fallback</span>
          </div>
          <p className="empty-state">This workspace could not render. Navigation remains available and no trading action was taken.</p>
        </article>
      )
    }

    return this.props.children
  }
}

function WorkspaceSidebar({ activeRoute, onNavigate, navRef }) {
  return (
    <aside
      id="workspace-sidebar"
      ref={navRef}
      className="app-sidebar"
      aria-label="Primary workspace navigation"
    >
      <div className="app-brand">
        <span className="app-brand-mark">AM</span>
        <div>
          <strong>Atlas Market</strong>
          <span>Trading OS</span>
        </div>
      </div>
      <nav className="app-sidebar-nav">
        {workspaceRoutes.map((route) => (
          <NavLink
            key={route.page}
            to={route.path}
            className={route.page === activeRoute.page ? 'app-sidebar-link active' : 'app-sidebar-link'}
            aria-current={route.page === activeRoute.page ? 'page' : undefined}
            aria-label={route.label}
            title={route.label}
            onClick={onNavigate}
          >
            <span className="app-sidebar-icon" aria-hidden="true"><WorkspaceIcon name={route.icon} /></span>
            <span className="app-sidebar-label">{route.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="app-sidebar-footer">
        <span>Mode</span>
        <strong>Paper Trading Only</strong>
      </div>
    </aside>
  )
}

export function WorkspaceLayout() {
  const auth = useIdentityAuth()
  const location = useLocation()
  const activeRoute = getWorkspaceRoute(location.pathname)
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const menuButtonRef = useRef(null)
  const sidebarRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || !isSidebarOpen) return
      setSidebarOpen(false)
      menuButtonRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSidebarOpen])

  useEffect(() => {
    if (!isSidebarOpen) return
    sidebarRef.current?.querySelector('a')?.focus()
  }, [isSidebarOpen])

  useEffect(() => {
    if (!isSidebarOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isSidebarOpen])

  const closeSidebar = (restoreFocus = false) => {
    setSidebarOpen(false)
    if (restoreFocus && isSidebarOpen) menuButtonRef.current?.focus()
  }

  return (
    <main className={`risk-dashboard trading-os-shell page-${activeRoute.page} ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <button
        ref={menuButtonRef}
        type="button"
        className="sidebar-menu-button"
        aria-controls="workspace-sidebar"
        aria-expanded={isSidebarOpen}
        aria-label={isSidebarOpen ? 'Close workspace navigation' : 'Open workspace navigation'}
        onClick={() => {
          if (isSidebarOpen) closeSidebar(true)
          else setSidebarOpen(true)
        }}
      >
        <span className="menu-button-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      <button type="button" className="sidebar-backdrop" aria-label="Close workspace navigation" onClick={() => closeSidebar(true)} />
      <WorkspaceSidebar activeRoute={activeRoute} onNavigate={() => closeSidebar(true)} navRef={sidebarRef} />
      <div className="trading-os-frame">
        <header className="app-top-nav">
          <div className="top-title-area">
            <WorkspaceBreadcrumb activeRoute={activeRoute} />
            <h1>{activeRoute.label}</h1>
          </div>
          <div className="top-status-strip">
            <span className="paper-pill">Paper Trading only</span>
            <span className="timestamp">{activeRoute.description}</span>
            <NavLink to="/settings" className="top-nav-settings">Settings</NavLink>
            <button type="button" className="top-nav-logout" onClick={auth.logout}>Sign out</button>
          </div>
        </header>
        <div className="workspace-route-content" key={location.pathname}>
          <WorkspaceRouteErrorBoundary routeKey={location.pathname}>
            <Suspense fallback={<FeaturePanelFallback label={activeRoute.label} />}>
              <Outlet />
            </Suspense>
          </WorkspaceRouteErrorBoundary>
        </div>
      </div>
    </main>
  )
}

export default WorkspaceLayout
