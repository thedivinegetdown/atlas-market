import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { OrderEntryPanel } from '../src/components/OrderEntryPanel'
import { OrdersPanel } from '../src/components/OrdersPanel'
import { PositionsPanel } from '../src/components/panels'
import { useOrderEntry } from '../src/hooks/useOrderEntry'
import { useOrders } from '../src/hooks/useOrders'
import { usePositions } from '../src/hooks/usePositions'
import { resetStore } from '../lib/repositories/store'
import { orderRepository } from '../src/hooks/tradingRuntime'

const quote = {
  symbol: 'AAPL',
  price: 100,
  open: 99,
  high: 101,
  low: 98,
  previousClose: 99,
  changePercent: 1,
  updatedAt: new Date().toISOString(),
}

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
  const orderEntry = useOrderEntry({ activeSymbol: 'AAPL', quote })
  const orders = useOrders()
  const positions = usePositions({ activeQuote: quote, accountValue: 100000 })

  useEffect(() => {
    orderEntry.previewOrder()
    orderEntry.submit()
    orders.refresh()
    positions.refresh()
  }, [])

  return (
    <div>
      <button type="button" onClick={orderEntry.previewOrder}>Preview</button>
      <button type="button" onClick={orderEntry.submit}>Submit</button>
      <button type="button" onClick={orders.refresh}>Refresh Orders</button>
      <button type="button" onClick={positions.refresh}>Refresh Positions</button>
      <span>{orderEntry.form.symbol}</span>
      <span>{orderEntry.preview?.symbol}</span>
      <span>{orders.orders.length}</span>
      <span>{positions.positions.length}</span>
    </div>
  )
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 10D paper execution', () => {
  it('renders order entry controls for paper execution', () => {
    renderWithRoot(<OrderEntryPanel quote={quote} />)

    expect(container.textContent).toContain('Order Entry')
    expect(container.textContent).toContain('Buy Market')
    expect(container.textContent).toContain('Sell Market')
    expect(container.textContent).toContain('Buy Limit')
    expect(container.textContent).toContain('Sell Limit')
    expect(container.textContent).toContain('Stop Limit')
    expect(container.textContent).toContain('Risk %')
  })

  it('validates an order before submit', () => {
    renderWithRoot(<OrderEntryPanel quote={quote} />)

    const quantity = container.querySelector('input[name="quantity"]')
    act(() => {
      quantity.value = '0'
      quantity.dispatchEvent(new Event('input', { bubbles: true }))
    })

    act(() => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(container.textContent).toContain('Quantity must be greater than zero')
    expect(container.textContent).toContain('Order validation failed')
  })

  it('previews an order before submission', () => {
    renderWithRoot(<OrderEntryPanel quote={quote} />)

    act(() => {
      container.querySelector('button[type="button"]').click()
    })

    expect(container.textContent).toContain('Order Preview')
    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('Notional')
  })

  it('submits a successful paper order and resets the form', async () => {
    renderWithRoot(<OrderEntryPanel quote={quote} />)

    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Pending')
    expect(container.textContent).toContain('paper order submitted')
    expect(container.querySelector('input[name="ticker"]').value).toBe('AAPL')
  })

  it('shows a failed paper order submission notification', async () => {
    const submitOrder = vi.fn(() => ({
      order: null,
      error: { message: 'risk blocked' },
    }))
    renderWithRoot(<OrderEntryPanel quote={quote} onSubmitOrder={submitOrder} />)

    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('risk blocked')
  })

  it('renders orders and cancels a working order', () => {
    const order = orderRepository.create({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
      state: 'WORKING',
      pnl: 0,
    })
    const onCancelOrder = vi.fn()

    renderWithRoot(<OrdersPanel orders={[order]} onCancelOrder={onCancelOrder} onRefresh={vi.fn()} />)

    expect(container.textContent).toContain('Pending')
    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('LIMIT')

    act(() => {
      container.querySelector('tbody button').click()
    })

    expect(onCancelOrder).toHaveBeenCalledWith(order.id)
  })

  it('renders positions with execution metrics', () => {
    renderWithRoot(<PositionsPanel positions={[{
      symbol: 'AAPL',
      quantity: 5,
      averageCost: 95,
      currentPrice: 100,
      marketValue: 500,
      unrealizedPnl: 25,
      realizedPnl: 0,
      dailyReturn: 1.2,
      riskPct: 0.03,
      weight: 0.5,
    }]} onRefresh={vi.fn()} />)

    expect(container.textContent).toContain('Quantity / Shares')
    expect(container.textContent).toContain('Entry Price')
    expect(container.textContent).toContain('Unrealized P/L')
    expect(container.textContent).toContain('Realized P/L')
    expect(container.textContent).toContain('Risk %')
  })

  it('exposes order entry, orders, and positions hook behavior', () => {
    renderWithRoot(<HookProbe />)

    expect(container.textContent).toContain('AAPL')
    expect(orderRepository.list().length).toBe(1)
  })
})
