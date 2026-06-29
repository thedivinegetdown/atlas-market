import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import React from 'react'
import App from '../src/App'
import { usePortfolio } from '../src/hooks/usePortfolio'
import { WatchlistPanel } from '../src/components/WatchlistPanel'
import { SignalPanel } from '../src/components/SignalPanel'
import { RiskPanel } from '../src/components/RiskPanel'
import { PortfolioSummaryPanel } from '../src/components/PortfolioSummaryPanel'
import { OrderEntryPanel } from '../src/components/OrderEntryPanel'
import { OrdersPanel } from '../src/components/OrdersPanel'

let root = null
let container = null

function renderWithRoot(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(ui)
  })

  return { container }
}

function HookProbe() {
  const portfolio = usePortfolio()
  return <div data-testid="portfolio-value">{portfolio.summary.accountValue}</div>
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 10 workspace', () => {
  it('renders the institutional trading dashboard shell', async () => {
    const { container } = renderWithRoot(<App />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Institutional Trading Workspace')
    expect(container.textContent).toContain('Watchlist')
    expect(container.textContent).toContain('Order Entry')
  })

  it('renders a watchlist with active symbols', async () => {
    const { container } = renderWithRoot(<WatchlistPanel />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('SPY')
    expect(container.textContent).toContain('Volume')
  })

  it('renders signal, risk, and portfolio summary panels', () => {
    const { container } = renderWithRoot(
      <div>
        <SignalPanel />
        <RiskPanel />
        <PortfolioSummaryPanel />
      </div>
    )

    expect(container.textContent).toContain('Overall Signal')
    expect(container.textContent).toContain('Position Size')
    expect(container.textContent).toContain('Account Value')
  })

  it('supports order entry submission and displays orders', () => {
    const { container } = renderWithRoot(
      <div>
        <OrderEntryPanel />
        <OrdersPanel />
      </div>
    )

    const ticker = container.querySelector('input[name="ticker"]')
    const quantity = container.querySelector('input[name="quantity"]')
    const price = container.querySelector('input[name="limitPrice"]')

    act(() => {
      ticker.value = 'AAPL'
      ticker.dispatchEvent(new Event('input', { bubbles: true }))
      quantity.value = '10'
      quantity.dispatchEvent(new Event('input', { bubbles: true }))
      price.value = '190'
      price.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = container.querySelector('form')
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('Pending')
  })

  it('exposes portfolio state from a hook', () => {
    const { container } = renderWithRoot(<HookProbe />)

    expect(container.textContent).toContain('100000')
  })
})
