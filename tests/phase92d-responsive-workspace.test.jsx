import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import App from '../src/App.jsx'
import { getWorkspaceRoute, workspaceRoutes } from '../src/workspaces/workspaceRoutes.js'

let root = null
let container = null

function renderAppAt(path = '/') {
  window.history.pushState({}, '', path)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(<App />)
  })

  return container
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  window.history.pushState({}, '', '/')
})

describe('Phase 92D responsive workspace shell', () => {
  it('opens and closes the mobile workspace navigation with keyboard focus return', () => {
    const rendered = renderAppAt('/')
    const menuButton = rendered.querySelector('.sidebar-menu-button')
    const shell = rendered.querySelector('.trading-os-shell')

    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(shell.className).not.toContain('sidebar-open')

    act(() => {
      menuButton.click()
    })

    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(shell.className).toContain('sidebar-open')
    expect(document.activeElement?.className).toContain('app-sidebar-link')
    expect(document.body.style.overflow).toBe('hidden')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(shell.className).not.toContain('sidebar-open')
    expect(document.activeElement).toBe(menuButton)
    expect(document.body.style.overflow).toBe('')
  })

  it('marks the active route accessibly and closes navigation after route selection', () => {
    const rendered = renderAppAt('/')
    const menuButton = rendered.querySelector('.sidebar-menu-button')

    act(() => {
      menuButton.click()
    })

    const marketsLink = [...rendered.querySelectorAll('.app-sidebar-link')]
      .find((link) => link.textContent.includes('Markets'))

    act(() => {
      marketsLink.click()
    })

    expect(rendered.querySelector('.trading-os-shell').className).not.toContain('sidebar-open')
    expect(marketsLink.getAttribute('aria-current')).toBe('page')
    expect(document.activeElement).toBe(menuButton)
    expect(rendered.textContent).toContain('Markets')
    expect(rendered.textContent).toContain('Data and regimes')
  })

  it('supports direct URL navigation for paper trading workspaces', () => {
    const rendered = renderAppAt('/orders')
    const activeLink = rendered.querySelector('.app-sidebar-link.active')

    expect(activeLink.textContent).toContain('Orders (Paper)')
    expect(activeLink.getAttribute('aria-current')).toBe('page')
    expect(rendered.textContent).toContain('Paper Trading only')
  })

  it('supports direct URL navigation for the dashboard workspace', () => {
    const rendered = renderAppAt('/dashboard')
    const activeLink = rendered.querySelector('.app-sidebar-link.active')

    expect(activeLink.textContent).toContain('Dashboard')
    expect(activeLink.getAttribute('aria-current')).toBe('page')
    expect(rendered.textContent).toContain('Executive overview')
  })

  it('uses dashboard metadata as the safe fallback for unknown shell routes', () => {
    const route = getWorkspaceRoute('/unknown-workspace')

    expect(route.page).toBe('dashboard')
    expect(route.label).toBe('Dashboard')
    expect(route.description).toBe('Executive overview')
  })

  it('renders one semantic stroked icon and accessible label for every workspace', () => {
    const rendered = renderAppAt('/')
    const links = [...rendered.querySelectorAll('.app-sidebar-link')]
    const expectedIcons = [
      'dashboard', 'markets', 'scanner', 'watchlist', 'portfolio', 'risk', 'orders',
      'strategies', 'backtesting', 'research', 'copilot', 'reports', 'health', 'settings',
    ]

    expect(workspaceRoutes.map((route) => route.icon)).toEqual(expectedIcons)
    expect(links).toHaveLength(workspaceRoutes.length)
    links.forEach((link, index) => {
      expect(link.getAttribute('aria-label')).toBe(workspaceRoutes[index].label)
      expect(link.getAttribute('title')).toBe(workspaceRoutes[index].label)
      expect(link.querySelector('svg')?.dataset.workspaceIcon).toBe(expectedIcons[index])
      expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    })
  })

  it('keeps paper-only and advisory-only boundaries visible in the Copilot route', () => {
    const rendered = renderAppAt('/copilot')

    expect(rendered.textContent).toContain('Paper Trading only')
    expect(rendered.textContent.toLowerCase()).toContain('advisory')
  })

  it('keeps responsive shell overflow and breakpoint rules in CSS', () => {
    const css = readFileSync('src/App.css', 'utf8')

    expect(css).toContain('.trading-os-shell')
    expect(css).toContain('overflow: hidden')
    expect(css).toContain('@media (max-width: 1180px)')
    expect(css).toContain('@media (max-width: 760px)')
    expect(css).toContain('transform: translateX(-104%)')
    expect(css).toContain('scrollbar-gutter: stable')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('transition-duration: 0.01ms')
    expect(css).toContain('.workspace-route-content')
  })
})
