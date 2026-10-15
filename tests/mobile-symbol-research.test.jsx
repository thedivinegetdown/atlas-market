import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import WatchlistWorkspace from '../src/workspaces/Watchlist/WatchlistWorkspace.jsx'
import SymbolResearchWorkspace from '../src/workspaces/Research/SymbolResearchWorkspace.jsx'

const NOW = '2026-10-15T19:59:00.000Z'

function candles(count = 260) {
  return Array.from({ length: count }, (_, index) => {
    const close = 150 + index * 0.2 + Math.sin(index / 4) * 3
    return {
      timestamp: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      open: close - 0.5,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000 + index * 1_000,
      symbol: 'AAPL',
      source: 'twelvedata',
      provider: 'twelvedata',
      completed: true,
    }
  })
}

const quote = {
  symbol: 'AAPL', price: 201.8, change: 1.2, changePercent: 0.6, updatedAt: NOW,
  provenance: { provider: 'twelvedata', dataStatus: 'STALE', observedAt: NOW, fallbackUsed: false, mock: false },
}

function overview(history = candles(), values = {
  shortMovingAverage: 199.2,
  mediumMovingAverage: 194.1,
  longMovingAverage: 178.5,
  atr: 4.25,
  atrPct: 2.1,
  relativeStrengthPct: 3.4,
}) {
  return {
    quote,
    research: {
      history: { candles: history, candleCount: history.length, requestedCount: 260, historyCompleteness: history.length === 260 ? 'COMPLETE' : 'TRUNCATED', provider: 'twelvedata', asOf: history.at(-1)?.timestamp },
      indicators: { asOf: history.at(-1)?.timestamp, values, coverage: { available: Object.keys(values), missing: [] } },
    },
  }
}

const scanner = {
  preparationId: 'prep-aapl-history',
  status: 'completed',
  createdAt: '2026-10-15T20:10:00.000Z',
  observationCoverage: {
    checks: [
      { symbol: 'AAPL', experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', status: 'BLOCKED_DEGRADED', reason: 'signal_insufficient_data', evaluatedAt: '2026-10-15T20:11:00.000Z' },
      { symbol: 'AAPL', experimentId: 'RANGE.1', strategyId: 'range-mean-reversion-v1', status: 'COMPLETED_NO_CANDIDATE', reason: 'signal_rejected', evaluatedAt: '2026-10-15T20:12:00.000Z' },
      { symbol: 'AAPL', experimentId: 'VOL.1', strategyId: 'volatility-expansion-v1', status: 'COMPLETED_NO_CANDIDATE', reason: 'signal_rejected', evaluatedAt: null },
    ],
  },
}

let root
let container

function render(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(ui))
}

beforeEach(() => {
  vi.spyOn(workspaceApiClient, 'getWatchlist')
  vi.spyOn(workspaceApiClient, 'getMarketOverview')
  vi.spyOn(workspaceApiClient, 'getGovernedReviewPreparationStatus')
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.restoreAllMocks()
})

describe('mobile symbol research workspace', () => {
  it('opens the selected Watchlist symbol in one tap with route context preserved', async () => {
    workspaceApiClient.getWatchlist.mockResolvedValue({ quotes: [quote] })
    function Destination() { return <div data-testid="destination">Research {useParams().symbol}</div> }
    render(<MemoryRouter initialEntries={['/watchlist']}><Routes>
      <Route path="/watchlist" element={<WatchlistWorkspace />} />
      <Route path="/research/:symbol" element={<Destination />} />
    </Routes></MemoryRouter>)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Research AAPL"]')).not.toBeNull())

    act(() => container.querySelector('[aria-label="Research AAPL"]').click())

    expect(container.textContent).toContain('Research AAPL')
  })

  it('renders supplied price/volume history, provenance, indicators, levels, and stored Scanner dispositions', () => {
    render(<SymbolResearchWorkspace symbol="AAPL" initialOverview={overview()} initialScanner={scanner} autoLoad={false} />)

    expect(container.querySelector('[aria-label="Market data status STALE"]')).not.toBeNull()
    expect(container.textContent).toContain('Provider: twelvedata')
    expect(container.querySelector('#research-chart-description').textContent).toContain('66 supplied daily candles')
    expect(container.querySelectorAll('.research-chart__volume')).toHaveLength(66)
    expect(container.textContent).toContain('SMA20')
    expect(container.textContent).toContain('$199.20')
    expect(container.textContent).toContain('ATR14')
    expect(container.textContent).toContain('$4.25')
    expect(container.textContent).toContain('Support')
    expect(container.textContent).toContain('Resistance')
    expect(container.textContent).toContain('BLOCKED_DEGRADED')
    expect(container.textContent).toContain('signal_insufficient_data')
    expect(container.textContent).toContain('HISTORICAL — evaluation timestamp unavailable')
    expect([...container.querySelectorAll('button')].map((button) => button.textContent).join(' ')).not.toMatch(/\bBUY\b|\bSELL\b|order|execute/i)
    expect(container.querySelector('form')).toBeNull()
  })

  it('switches 1M/3M/1Y locally over the trusted supplied candle set', () => {
    render(<SymbolResearchWorkspace symbol="AAPL" initialOverview={overview()} initialScanner={scanner} autoLoad={false} />)
    const oneMonth = container.querySelector('button[aria-pressed="false"]')

    act(() => oneMonth.click())

    expect(oneMonth.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('#research-chart-description').textContent).toContain('22 supplied daily candles')
    expect(container.querySelectorAll('.research-chart__volume')).toHaveLength(22)
  })

  it('keeps each missing evidence section explicitly fail closed', () => {
    render(<SymbolResearchWorkspace symbol="AAPL" initialOverview={overview(candles(10), {})} autoLoad={false} />)

    expect(container.textContent).toContain('SMA20')
    expect(container.textContent).toContain('Requires 20 completed daily closes')
    expect(container.textContent).toContain('Requires 200 completed daily closes')
    expect(container.textContent).toContain('Requires 15 completed daily candles')
    expect(container.querySelector('#symbol-research-levels').textContent).toContain('INSUFFICIENT')
    expect(container.querySelector('#symbol-research-scanner').textContent).toContain('UNAVAILABLE')
  })

  it('uses a responsive, non-clipping chart contract for the 390px acceptance width', () => {
    const css = readFileSync('src/workspaces/Research/SymbolResearchWorkspace.css', 'utf8')
    render(<SymbolResearchWorkspace symbol="AAPL" initialOverview={overview()} initialScanner={scanner} autoLoad={false} />)

    expect(css).toMatch(/\.research-chart \{[^}]*width:100%[^}]*min-width:0/s)
    expect(css).toMatch(/@media \(max-width:420px\)/)
    expect(container.querySelector('.research-chart svg').getAttribute('preserveAspectRatio')).toBe('none')
    expect(container.querySelectorAll('.symbol-research-panel')).toHaveLength(5)
  })
})
