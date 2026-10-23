import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import { MarketSessionProvider } from '../src/state/MarketSessionProvider.jsx'
import { createMarketSessionIdentityKey, isReusableQuoteEvidence, useMarketSession } from '../src/state/marketSessionState.js'
import WatchlistWorkspace from '../src/workspaces/Watchlist/WatchlistWorkspace.jsx'
import ResearchWorkspace from '../src/workspaces/Research/ResearchWorkspace.jsx'

const NOW = '2026-10-15T19:59:00.000Z'

function quote(symbol = 'AAPL', status = 'STALE', price = 201.8) {
  return {
    symbol,
    price,
    change: 1.2,
    changePercent: 0.6,
    updatedAt: NOW,
    evidenceId: `${symbol}-${status}-evidence`,
    provenance: { provider: status === 'MOCK' ? 'mock-market-data' : 'twelvedata', dataStatus: status, observedAt: NOW, fallbackUsed: status === 'MOCK', mock: status === 'MOCK' },
  }
}

function candles(symbol = 'AAPL', count = 260) {
  return Array.from({ length: count }, (_, index) => ({
    symbol,
    timestamp: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
    open: 150 + index,
    high: 152 + index,
    low: 148 + index,
    close: 151 + index,
    volume: 1_000_000 + index,
  }))
}

function historyOverview(symbol = 'AAPL', responseQuote = null) {
  const history = candles(symbol)
  // Supplied-response rendering fixture only; this does not qualify a provider.
  const completion = { status: 'CONFIRMED_COMPLETED' }
  return {
    quote: responseQuote,
    research: {
      history: { candles: history, candleCount: 260, requestedCount: 260, historyCompleteness: 'COMPLETE', provider: 'twelvedata', asOf: history.at(-1).timestamp, completion },
      indicators: { asOf: history.at(-1).timestamp, coverage: { completion }, values: { shortMovingAverage: 199, mediumMovingAverage: 194, longMovingAverage: 178, atr: 4.2, atrPct: 2.1, relativeStrengthPct: 3.4 } },
    },
  }
}

function WatchlistRoute() {
  const navigate = useNavigate()
  return <><WatchlistWorkspace /><button type="button" onClick={() => navigate('/research/MSFT')}>Open MSFT directly</button></>
}

function ResearchRoute() {
  const navigate = useNavigate()
  return <><ResearchWorkspace /><button type="button" onClick={() => navigate(-1)}>Browser Back</button></>
}

function TestApp({ identityKey = 'org-atlas-local:user-a', initialEntries = ['/watchlist'] }) {
  return <MemoryRouter initialEntries={initialEntries}>
    <MarketSessionProvider key={identityKey} identityKey={identityKey}>
      <Routes>
        <Route path="/watchlist" element={<WatchlistRoute />} />
        <Route path="/research/:symbol" element={<ResearchRoute />} />
      </Routes>
    </MarketSessionProvider>
  </MemoryRouter>
}

function SessionProbe({ snapshot, symbol = 'AAPL' }) {
  const session = useMarketSession()
  const [, setRevision] = useState(0)
  return <div>
    <button type="button" onClick={() => { session.writeWatchlist(snapshot); setRevision((value) => value + 1) }}>Store snapshot</button>
    <span data-testid="cached-quote">{session.readQuote(symbol)?.evidenceId ?? 'none'}</span>
    <span data-testid="cached-status">{session.readQuote(symbol)?.provenance?.dataStatus ?? 'none'}</span>
  </div>
}

function IdentityScopedProbe({ user, organizationId = 'org-atlas-local', snapshot }) {
  if (!user) return <span>signed-out</span>
  const identityKey = createMarketSessionIdentityKey(user, organizationId)
  return <MarketSessionProvider key={identityKey} identityKey={identityKey}><SessionProbe snapshot={snapshot} /></MarketSessionProvider>
}

let root
let container

function render(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(ui))
}

async function click(selector) {
  await act(async () => {
    container.querySelector(selector).click()
    await Promise.resolve()
  })
}

async function clickButton(label) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.spyOn(workspaceApiClient, 'getWatchlist')
  vi.spyOn(workspaceApiClient, 'getResearchHistory')
  vi.spyOn(workspaceApiClient, 'getGovernedReviewPreparationStatus').mockResolvedValue({ observationCoverage: { checks: [] } })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

describe('authenticated market session reuse', () => {
  it('carries the exact Watchlist quote into Research and requests history without reacquiring quote', async () => {
    const aapl = quote()
    let resolveHistory
    workspaceApiClient.getWatchlist.mockResolvedValue({ quotes: [aapl] })
    workspaceApiClient.getResearchHistory.mockReturnValue(new Promise((resolve) => { resolveHistory = resolve }))
    render(<TestApp />)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy())

    await click('[aria-label="Research AAPL"]')
    await vi.waitFor(() => expect(workspaceApiClient.getResearchHistory).toHaveBeenCalledWith('AAPL', { skipQuote: true }))
    expect(container.querySelector('#symbol-research-quote').textContent).toContain('$201.80')
    expect(container.querySelector('[aria-label="Market data status STALE"]')).toBeTruthy()

    await act(async () => { resolveHistory(historyOverview()); await Promise.resolve() })
    expect(container.querySelector('#research-chart-description').textContent).toContain('66 supplied daily candles')
    expect(container.querySelector('#symbol-research-quote').textContent).toContain('$201.80')
  })

  it('deep links normally, and symbol mismatch rejects carried evidence', async () => {
    const aapl = quote()
    const msft = quote('MSFT', 'LIVE', 420)
    workspaceApiClient.getWatchlist.mockResolvedValue({ quotes: [aapl] })
    workspaceApiClient.getResearchHistory.mockImplementation(async (symbol) => historyOverview(symbol, symbol === 'MSFT' ? msft : aapl))
    render(<TestApp />)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy())

    await clickButton('Open MSFT directly')
    await vi.waitFor(() => expect(workspaceApiClient.getResearchHistory).toHaveBeenCalledWith('MSFT', { skipQuote: false }))
    expect(container.querySelector('#symbol-research-quote').textContent).toContain('$420.00')

    act(() => root.unmount())
    container.remove()
    root = null
    container = null
    workspaceApiClient.getResearchHistory.mockClear()
    render(<TestApp initialEntries={['/research/AAPL']} />)
    await vi.waitFor(() => expect(workspaceApiClient.getResearchHistory).toHaveBeenCalledWith('AAPL', { skipQuote: false }))
  })

  it.each(['STALE', 'MOCK'])('preserves the carried %s classification exactly', async (status) => {
    workspaceApiClient.getWatchlist.mockResolvedValue({ quotes: [quote('AAPL', status)] })
    workspaceApiClient.getResearchHistory.mockResolvedValue(historyOverview())
    render(<TestApp />)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy())
    await click('[aria-label="Research AAPL"]')
    await vi.waitFor(() => expect(container.querySelector(`[aria-label="Market data status ${status}"]`)).toBeTruthy())
  })

  it('restores Watchlist on Back with zero automatic batch refetches and retains manual Refresh', async () => {
    const aapl = quote()
    const refreshed = quote('AAPL', 'LIVE', 205)
    workspaceApiClient.getWatchlist
      .mockResolvedValueOnce({ quotes: [aapl] })
      .mockResolvedValueOnce({ quotes: [refreshed] })
    workspaceApiClient.getResearchHistory.mockResolvedValue(historyOverview())
    render(<TestApp />)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy())
    await click('[aria-label="Research AAPL"]')
    await vi.waitFor(() => expect(container.querySelector('#research-chart-description')).toBeTruthy())
    await clickButton('Browser Back')

    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy())
    expect(workspaceApiClient.getWatchlist).toHaveBeenCalledOnce()
    expect(container.querySelector('[aria-label="Market data status STALE"]')).toBeTruthy()

    await click('[aria-label="Refresh watchlist"]')
    await vi.waitFor(() => expect(workspaceApiClient.getWatchlist).toHaveBeenCalledTimes(2))
    expect(container.textContent).toContain('$205.00')
    expect(container.querySelector('[aria-label="Market data status LIVE"]')).toBeTruthy()
  })

  it('hard reload loses the in-memory snapshot and loads Watchlist normally', async () => {
    workspaceApiClient.getWatchlist.mockResolvedValue({ quotes: [quote()] })
    render(<TestApp />)
    await vi.waitFor(() => expect(workspaceApiClient.getWatchlist).toHaveBeenCalledOnce())
    act(() => root.unmount())
    container.remove()
    root = null
    container = null

    render(<TestApp />)
    await vi.waitFor(() => expect(workspaceApiClient.getWatchlist).toHaveBeenCalledTimes(2))
  })

  it('keeps 1M, 3M, and 1Y switching local after the single history request', async () => {
    workspaceApiClient.getWatchlist.mockResolvedValue({ quotes: [quote()] })
    workspaceApiClient.getResearchHistory.mockResolvedValue(historyOverview())
    render(<TestApp />)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy())
    await click('[aria-label="Research AAPL"]')
    await vi.waitFor(() => expect(container.querySelector('#research-chart-description')?.textContent).toContain('66 supplied'))

    await click('.research-timeframes button:nth-child(1)')
    expect(container.querySelector('#research-chart-description').textContent).toContain('22 supplied')
    await click('.research-timeframes button:nth-child(2)')
    expect(container.querySelector('#research-chart-description').textContent).toContain('66 supplied')
    await click('.research-timeframes button:nth-child(3)')
    expect(container.querySelector('#research-chart-description').textContent).toContain('260 supplied')
    expect(workspaceApiClient.getResearchHistory).toHaveBeenCalledOnce()
    expect(workspaceApiClient.getGovernedReviewPreparationStatus).toHaveBeenCalledOnce()
  })

  it('invalidates reusable evidence across user and organization identity changes', async () => {
    const snapshot = { quotes: [quote()], selectedSymbol: 'AAPL' }
    const userAOrgA = createMarketSessionIdentityKey({ id: 'user-a' }, 'org-a')
    const userBOrgA = createMarketSessionIdentityKey({ id: 'user-b' }, 'org-a')
    const userAOrgB = createMarketSessionIdentityKey({ id: 'user-a' }, 'org-b')
    render(<MarketSessionProvider key={userAOrgA} identityKey={userAOrgA}><SessionProbe snapshot={snapshot} /></MarketSessionProvider>)
    await click('button')
    expect(container.querySelector('[data-testid="cached-quote"]').textContent).toBe('AAPL-STALE-evidence')

    act(() => root.render(<MarketSessionProvider key={userBOrgA} identityKey={userBOrgA}><SessionProbe snapshot={snapshot} /></MarketSessionProvider>))
    expect(container.querySelector('[data-testid="cached-quote"]').textContent).toBe('none')
    act(() => root.render(<MarketSessionProvider key={userAOrgB} identityKey={userAOrgB}><SessionProbe snapshot={snapshot} /></MarketSessionProvider>))
    expect(container.querySelector('[data-testid="cached-quote"]').textContent).toBe('none')
  })

  it('discards the in-memory snapshot across logout and a later login', async () => {
    const snapshot = { quotes: [quote()], selectedSymbol: 'AAPL' }
    const user = { id: 'user-a' }
    render(<IdentityScopedProbe user={user} snapshot={snapshot} />)
    await click('button')
    expect(container.querySelector('[data-testid="cached-quote"]').textContent).toBe('AAPL-STALE-evidence')

    act(() => root.render(<IdentityScopedProbe user={null} snapshot={snapshot} />))
    expect(container.textContent).toContain('signed-out')
    act(() => root.render(<IdentityScopedProbe user={user} snapshot={snapshot} />))
    expect(container.querySelector('[data-testid="cached-quote"]').textContent).toBe('none')
  })

  it('ignores malformed cached evidence and preserves fail-closed refresh errors over a valid snapshot', async () => {
    const malformed = { quotes: [{ symbol: 'AAPL', price: 200, provenance: { provider: 'twelvedata', dataStatus: 'LIVE' } }], selectedSymbol: 'AAPL' }
    render(<MarketSessionProvider identityKey="org-a:user-a"><SessionProbe snapshot={malformed} /></MarketSessionProvider>)
    await click('button')
    expect(container.querySelector('[data-testid="cached-quote"]').textContent).toBe('none')

    act(() => root.unmount())
    container.remove()
    root = null
    container = null
    workspaceApiClient.getWatchlist.mockResolvedValueOnce({ quotes: [quote()] }).mockRejectedValueOnce(new Error('watchlist refresh failed'))
    render(<TestApp />)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy())
    await click('[aria-label="Refresh watchlist"]')
    await vi.waitFor(() => expect(container.textContent).toContain('watchlist refresh failed'))
    expect(container.querySelector('[aria-label="Research AAPL"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Market data status STALE"]')).toBeTruthy()
  })

  it('rejects malformed prices, timestamps, providers, and contradictory provenance', () => {
    const provenance = quote().provenance
    for (const price of [null, '', 0, -1, Number.NaN]) {
      expect(isReusableQuoteEvidence({ ...quote(), price }, 'AAPL')).toBe(false)
    }
    expect(isReusableQuoteEvidence({ ...quote(), provenance: { ...provenance, observedAt: 'not-a-timestamp' } }, 'AAPL')).toBe(false)
    expect(isReusableQuoteEvidence({ ...quote(), provenance: { ...provenance, observedAt: undefined }, updatedAt: NOW }, 'AAPL')).toBe(false)
    expect(isReusableQuoteEvidence({ ...quote(), provenance: { ...provenance, provider: 'unknown' } }, 'AAPL')).toBe(false)
    expect(isReusableQuoteEvidence({ ...quote(), provenance: { ...provenance, dataStatus: 'LIVE', provider: 'mock', mock: true } }, 'AAPL')).toBe(false)
    expect(isReusableQuoteEvidence({ ...quote(), provenance: { ...provenance, dataStatus: 'MOCK', mock: false } }, 'AAPL')).toBe(false)
    expect(isReusableQuoteEvidence({ ...quote(), provenance: { ...provenance, dataStatus: 'LIVE', fallbackUsed: true } }, 'AAPL')).toBe(false)
  })

  it('stores an immutable copy so later source mutation cannot upgrade provenance', async () => {
    const original = quote('AAPL', 'MOCK')
    const snapshot = { quotes: [original], selectedSymbol: 'AAPL' }
    render(<MarketSessionProvider identityKey="org-a:user-a"><SessionProbe snapshot={snapshot} /></MarketSessionProvider>)
    await click('button')
    expect(container.querySelector('[data-testid="cached-status"]').textContent).toBe('MOCK')

    original.price = 999
    original.provenance = { ...original.provenance, provider: 'twelvedata', dataStatus: 'LIVE', mock: false, fallbackUsed: false }
    act(() => root.render(<MarketSessionProvider identityKey="org-a:user-a"><SessionProbe snapshot={snapshot} /></MarketSessionProvider>))

    expect(container.querySelector('[data-testid="cached-status"]').textContent).toBe('MOCK')
    expect(container.querySelector('[data-testid="cached-quote"]').textContent).toBe('AAPL-MOCK-evidence')
  })
})
