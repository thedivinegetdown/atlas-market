import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { WatchlistPanel } from '../src/components/WatchlistPanel'
import { MarketOverviewPanel } from '../src/components/MarketOverviewPanel'

const quotes = [
  {
    symbol: 'MSFT',
    price: 410.25,
    change: 1.5,
    changePercent: 0.37,
    volume: 700000,
    open: 408,
    high: 412,
    low: 407,
    previousClose: 408.75,
    updatedAt: '2026-06-29T14:30:00.000Z',
  },
  {
    symbol: 'AAPL',
    price: 190.1,
    change: -0.7,
    changePercent: -0.37,
    volume: 1200000,
    open: 191,
    high: 192,
    low: 189,
    previousClose: 190.8,
    updatedAt: '2026-06-29T14:31:00.000Z',
  },
]

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

function firstSymbol() {
  return container.querySelector('tbody tr:first-child .symbol-button')?.textContent
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 10B watchlist and market overview', () => {
  it('renders watchlist market columns and signal badges', () => {
    renderWithRoot(<WatchlistPanel quotes={quotes} selectedSymbol="MSFT" />)

    expect(container.textContent).toContain('Last price')
    expect(container.textContent).toContain('Daily $')
    expect(container.textContent).toContain('Trend')
    expect(container.textContent).toContain('Signal')
    expect(container.textContent).toContain('MSFT')
  })

  it('selects the active symbol when a symbol row is clicked', () => {
    const onSelectSymbol = vi.fn()
    renderWithRoot(
      <WatchlistPanel quotes={quotes} selectedSymbol="MSFT" onSelectSymbol={onSelectSymbol} />,
    )

    act(() => {
      container.querySelector('.symbol-button').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectSymbol).toHaveBeenCalledWith('AAPL')
  })

  it('sorts the watchlist by symbol, price, change percent, and volume', () => {
    renderWithRoot(<WatchlistPanel quotes={quotes} selectedSymbol="MSFT" />)

    expect(firstSymbol()).toBe('AAPL')

    const sortSelect = container.querySelector('select[aria-label="Sort watchlist"]')

    act(() => {
      sortSelect.value = 'price'
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(firstSymbol()).toBe('AAPL')

    act(() => {
      container.querySelector('.panel-actions-right button').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(firstSymbol()).toBe('MSFT')

    act(() => {
      sortSelect.value = 'volume'
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(firstSymbol()).toBe('AAPL')

    act(() => {
      sortSelect.value = 'changePercent'
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(firstSymbol()).toBe('MSFT')
  })

  it('calls refresh from the watchlist refresh button', () => {
    const onRefresh = vi.fn()
    renderWithRoot(<WatchlistPanel quotes={quotes} selectedSymbol="MSFT" onRefresh={onRefresh} />)

    act(() => {
      const buttons = [...container.querySelectorAll('button')]
      buttons.find((button) => button.textContent === 'Refresh').click()
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders watchlist loading and error states', () => {
    renderWithRoot(<WatchlistPanel quotes={[]} loading error="Market data unavailable" />)

    expect(container.textContent).toContain('Loading watchlist quotes')
    expect(container.textContent).toContain('Market data unavailable')
  })

  it('renders market overview values for the active symbol', () => {
    renderWithRoot(<MarketOverviewPanel symbol="MSFT" quote={quotes[0]} />)

    expect(container.textContent).toContain('Market Overview')
    expect(container.textContent).toContain('Active Symbol')
    expect(container.textContent).toContain('Current Price')
    expect(container.textContent).toContain('Previous Close')
    expect(container.textContent).toContain('Last Updated')
  })

  it('calls refresh for the selected market overview symbol', () => {
    const onRefresh = vi.fn()
    renderWithRoot(<MarketOverviewPanel symbol="MSFT" quote={quotes[0]} onRefresh={onRefresh} />)

    act(() => {
      container.querySelector('button').click()
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders market overview empty, loading, and error states', () => {
    renderWithRoot(<MarketOverviewPanel />)
    expect(container.textContent).toContain('Select a symbol')

    act(() => {
      root.render(<MarketOverviewPanel symbol="MSFT" loading error="Selected symbol unavailable" />)
    })

    expect(container.textContent).toContain('Loading market overview')
    expect(container.textContent).toContain('Selected symbol unavailable')
  })
})
