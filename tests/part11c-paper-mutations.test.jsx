import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { handler as cancelPaperOrderHandler } from '../netlify/functions/cancel-paper-order.js'
import { handler as submitPaperOrderHandler } from '../netlify/functions/submit-paper-order.js'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import { OrderEntryPanel } from '../src/components/OrderEntryPanel.jsx'
import { OrdersPanel } from '../src/components/OrdersPanel.jsx'
import { orderRepository } from '../src/hooks/tradingRuntime.js'
import { resetStore } from '../lib/repositories/store.js'

const quote = {
  symbol: 'AAPL',
  price: 100,
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

async function invoke(handler, body) {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  return {
    statusCode: response.statusCode,
    payload: JSON.parse(response.body),
  }
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

describe('Part 11C paper trading mutation API', () => {
  it('submits a paper order through the Netlify function', async () => {
    const response = await invoke(submitPaperOrderHandler, {
      paperTrading: true,
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
      limitPrice: 100,
      timeInForce: 'DAY',
      quote,
    })

    expect(response.statusCode).toBe(200)
    expect(response.payload.ok).toBe(true)
    expect(response.payload.data.paperTrading).toBe(true)
    expect(response.payload.data.order.symbol).toBe('AAPL')
    expect(response.payload.data.order.state).toBe('WORKING')
  })

  it('returns validation failures for invalid submit order payloads', async () => {
    const missingSymbol = await invoke(submitPaperOrderHandler, {
      paperTrading: true,
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
    })
    const invalidSide = await invoke(submitPaperOrderHandler, {
      paperTrading: true,
      symbol: 'AAPL',
      side: 'HOLD',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
    })
    const liveMode = await invoke(submitPaperOrderHandler, {
      paperTrading: false,
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
    })

    expect(missingSymbol.statusCode).toBe(400)
    expect(missingSymbol.payload.error.code).toBe('missing_symbol')
    expect(invalidSide.statusCode).toBe(400)
    expect(invalidSide.payload.error.code).toBe('invalid_order_side')
    expect(liveMode.statusCode).toBe(400)
    expect(liveMode.payload.error.code).toBe('paper_trading_required')
  })

  it('returns an engine failure when risk blocks the submitted order', async () => {
    const response = await invoke(submitPaperOrderHandler, {
      paperTrading: true,
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 10,
      price: 100,
      limitPrice: 100,
      quote,
    })

    expect(response.statusCode).toBe(400)
    expect(response.payload.ok).toBe(false)
    expect(response.payload.error.code).toBe('risk_blocked')
  })

  it('cancels a cancellable paper order through the Netlify function', async () => {
    const created = orderRepository.create({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
      state: 'WORKING',
    })

    const response = await invoke(cancelPaperOrderHandler, { orderId: created.id })

    expect(response.statusCode).toBe(200)
    expect(response.payload.ok).toBe(true)
    expect(response.payload.data.order.state).toBe('CANCELED')
  })

  it('rejects cancelling a non-cancellable paper order', async () => {
    const created = orderRepository.create({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
      price: 100,
      state: 'FILLED',
    })

    const response = await invoke(cancelPaperOrderHandler, { orderId: created.id })

    expect(response.statusCode).toBe(400)
    expect(response.payload.ok).toBe(false)
    expect(response.payload.error.code).toBe('order_not_cancellable')
  })

  it('exposes frontend API client mutation helpers', async () => {
    const submitted = await workspaceApiClient.submitPaperOrder({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
      limitPrice: 100,
      quote,
    })
    const canceled = await workspaceApiClient.cancelPaperOrder(submitted.order.id)

    expect(submitted.paperTrading).toBe(true)
    expect(submitted.order.state).toBe('WORKING')
    expect(canceled.order.state).toBe('CANCELED')
  })

  it('submits from the order entry panel and notifies related panel refresh', async () => {
    const onMutationSuccess = vi.fn()

    renderWithRoot(<OrderEntryPanel quote={quote} onMutationSuccess={onMutationSuccess} />)

    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('paper order submitted')
    expect(onMutationSuccess).toHaveBeenCalledTimes(1)
  })

  it('cancels from the orders panel and notifies related panel refresh', async () => {
    const created = orderRepository.create({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
      state: 'WORKING',
    })
    const onCancelOrder = vi.fn(async () => ({ ...created, state: 'CANCELED' }))
    const onMutationSuccess = vi.fn()

    renderWithRoot(
      <OrdersPanel
        orders={[created]}
        onCancelOrder={onCancelOrder}
        onRefresh={vi.fn()}
        onMutationSuccess={onMutationSuccess}
      />
    )

    await act(async () => {
      container.querySelector('tbody button').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onCancelOrder).toHaveBeenCalledWith(created.id)
    expect(onMutationSuccess).toHaveBeenCalledTimes(1)
  })
})
