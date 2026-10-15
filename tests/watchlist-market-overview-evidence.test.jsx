import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import WatchlistWorkspace from '../src/workspaces/Watchlist/WatchlistWorkspace.jsx'

const staleQuote = {
  symbol: 'SPY',
  price: 771.71,
  bid: 771.71,
  ask: 771.71,
  open: 766.26,
  high: 772.86,
  low: 764.43,
  previousClose: 769.6,
  change: 2.11,
  changePercent: 0.27,
  volume: 103987210,
  provider: 'twelvedata',
  updatedAt: '2026-10-15T19:59:00.000Z',
  provenance: {
    available: true,
    provider: 'twelvedata',
    dataStatus: 'STALE',
    freshness: 'STALE',
    sourceObservedAt: '2026-10-15T19:59:00.000Z',
    fallbackUsed: false,
    mock: false,
  },
}

let root
let container
let getWatchlist
let getMarketOverview

async function renderWorkspace(quotes) {
  getWatchlist.mockResolvedValue({ quotes })
  await act(async () => {
    root.render(<MemoryRouter><WatchlistWorkspace /></MemoryRouter>)
  })
  await vi.waitFor(() => expect(getWatchlist).toHaveBeenCalledTimes(1))
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  getWatchlist = vi.spyOn(workspaceApiClient, 'getWatchlist')
  getMarketOverview = vi.spyOn(workspaceApiClient, 'getMarketOverview').mockResolvedValue({
    quote: { symbol: 'SPY', provider: 'mock', provenance: { dataStatus: 'MOCK', mock: true } },
    regime: null,
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.restoreAllMocks()
})

describe('Watchlist Market Overview evidence reuse', () => {
  it('reuses the selected server-owned Watchlist quote without an automatic provider request', async () => {
    await renderWorkspace([staleQuote])

    expect(getMarketOverview).not.toHaveBeenCalled()
    expect(container.textContent).toContain('$771.71')
    expect(container.textContent).toContain('Provider: twelvedata')
    expect(container.textContent).toContain('STALE')
    expect(container.textContent).not.toContain('MOCK DATA')
    expect(container.querySelector('#watchlist-market-overview')?.textContent).toContain(
      new Date(staleQuote.updatedAt).toLocaleString(),
    )
  })

  it('preserves mock provenance instead of upgrading unavailable provider evidence', async () => {
    await renderWorkspace([{
      ...staleQuote,
      price: 100,
      provider: 'mock',
      updatedAt: null,
      provenance: {
        available: false,
        provider: 'mock',
        dataStatus: 'MOCK',
        freshness: 'UNKNOWN',
        sourceObservedAt: null,
        fallbackUsed: true,
        mock: true,
      },
    }])

    expect(getMarketOverview).not.toHaveBeenCalled()
    expect(container.querySelector('#watchlist-market-overview')?.textContent).toContain('MOCK DATA')
    expect(container.querySelector('#watchlist-market-overview')?.textContent).toContain('As of: unavailable')
  })
})
