import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import App from '../src/App'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient'
import { useWatchlist } from '../src/hooks/useWatchlist'

let root = null
let container = null
const routedFetch = globalThis.fetch

function renderWithRoot(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(ui)
  })

  return { container }
}

async function flushApi() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function HookProbe() {
  const watchlist = useWatchlist()
  return (
    <div>
      <span>{watchlist.isLoading ? 'loading' : 'ready'}</span>
      <span>{watchlist.error ?? 'no-error'}</span>
      <span>{watchlist.quotes.map((quote) => quote.symbol).join(',')}</span>
      <button type="button" onClick={watchlist.refresh}>Refresh Watchlist</button>
    </div>
  )
}

afterEach(() => {
  globalThis.fetch = routedFetch
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 11B workspace API client integration', () => {
  it('parses successful API client responses', async () => {
    const client = createWorkspaceApiClient({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        async json() {
          return { ok: true, data: { paperTrading: true, quotes: [{ symbol: 'SPY' }] } }
        },
      }),
    })

    await expect(client.getWatchlist()).resolves.toEqual({
      paperTrading: true,
      quotes: [{ symbol: 'SPY' }],
    })
  })

  it('throws clean API client errors from standard error responses', async () => {
    const client = createWorkspaceApiClient({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        async json() {
          return { ok: false, error: { code: 'invalid_symbol', message: 'symbol is invalid' } }
        },
      }),
    })

    await expect(client.getMarketOverview('../SPY')).rejects.toThrow('symbol is invalid')
  })

  it('exposes hook loading and refresh behavior with API-backed data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return { ok: true, data: { paperTrading: true, quotes: [{ symbol: 'SPY', price: 100 }] } }
      },
    })
    globalThis.fetch = fetchMock

    renderWithRoot(<HookProbe />)

    expect(container.textContent).toContain('loading')
    await flushApi()
    expect(container.textContent).toContain('ready')
    expect(container.textContent).toContain('SPY')

    act(() => {
      container.querySelector('button').click()
    })
    await flushApi()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('exposes hook error state from API errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      async json() {
        return { ok: false, error: { code: 'api_down', message: 'workspace unavailable' } }
      },
    })

    renderWithRoot(<HookProbe />)
    await flushApi()

    expect(container.textContent).toContain('workspace unavailable')
  })

  it('renders workspace panels with API-backed data', async () => {
    renderWithRoot(<App />)
    await flushApi()

    expect(container.textContent).toContain('Paper Trading')
    expect(container.textContent).toContain('SPY')
    expect(container.textContent).toContain('Watchlist')
    expect(container.textContent).toContain('Market Overview')
    expect(container.textContent).toContain('Portfolio Summary')
  })
})
