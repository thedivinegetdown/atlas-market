import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import { DailyBriefingPanel, DashboardSections } from '../src/workspaces/Dashboard/dashboardSections.jsx'

let root; let container
function render(element) { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(element)); return container }
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.restoreAllMocks(); root = null; container = null })
function briefing(status = 'READY') { return { status, asOf: '2026-07-30T20:00:00Z', market: { trendRegime: status === 'INSUFFICIENT_DATA' ? 'UNKNOWN' : 'BULL', riskRegime: 'RISK_ON', confidence: 85, freshness: 'FRESH' }, strategies: { enabled: 1, conditional: status === 'CAUTION' ? 1 : 0 }, opportunities: [], portfolioRisk: { openRisk: 500, drawdown: 2 }, operations: { criticalAlerts: 0 }, priorities: [{ id: 'review', level: status === 'CAUTION' ? 'MEDIUM' : 'INFORMATIONAL', title: 'Review current briefing', reason: 'Human review only.' }], warnings: [] } }

describe('Dashboard Daily Briefing', () => {
  it('renders loading and error states accessibly', () => {
    expect(render(<DailyBriefingPanel state={{ isLoading: true }} />).querySelector('[role="status"]').textContent).toContain('Loading')
    act(() => root.unmount()); root = createRoot(container); act(() => root.render(<DailyBriefingPanel state={{ error: 'failed', isLoading: false }} />))
    expect(container.querySelector('[role="alert"]').textContent).toContain('unavailable')
  })
  it.each(['READY', 'CAUTION', 'INSUFFICIENT_DATA'])('renders the %s briefing state', (status) => {
    const view = render(<DailyBriefingPanel state={{ briefing: briefing(status), isLoading: false }} />)
    expect(view.textContent).toContain(status.replaceAll('_', ' '))
    expect(view.textContent).toContain('Paper trading remains mandatory')
    expect(view.textContent).not.toMatch(/place order|buy|sell/i)
  })
  it('renders the no-reviewed-opportunity state explicitly', () => expect(render(<DailyBriefingPanel state={{ briefing: briefing(), isLoading: false }} />).textContent).toContain('No bounded reviewed opportunities'))
  it('renders compact reviewed opportunity context', () => {
    const value = briefing('CAUTION')
    value.opportunities = [{ opportunityId: 'opp-aapl', symbol: 'AAPL', strategyId: 'index-pullback-v1', score: 84, band: 'STRONG', confidence: 79, freshness: 'FRESH', reviewState: 'saved', reasons: ['Trend evidence aligned'], blockers: ['Review liquidity'] }]
    const view = render(<DailyBriefingPanel state={{ briefing: value, isLoading: false }} />)
    expect(view.textContent).toContain('AAPL: 84')
    expect(view.textContent).toContain('index-pullback-v1')
    expect(view.textContent).toContain('1 blocker(s)')
  })
  it.each([
    [{ provider: 'twelvedata', dataStatus: 'LIVE', freshness: 'FRESH' }, 'LIVE'],
    [{ provider: 'mock', dataStatus: 'MOCK', freshness: 'FRESH', mock: true }, 'MOCK DATA'],
    [{ provider: 'unknown', dataStatus: 'UNAVAILABLE', freshness: 'UNKNOWN' }, 'UNAVAILABLE'],
  ])('renders the briefing market provenance without promotion', (marketData, label) => {
    const value = briefing()
    value.market.marketData = marketData
    const view = render(<DailyBriefingPanel state={{ briefing: value, isLoading: false }} />)
    expect(view.textContent).toContain(label)
    if (marketData.dataStatus !== 'LIVE') expect(view.textContent).not.toContain('Provider: twelvedata')
  })
  it('reuses the Daily Briefing market overview without a second Dashboard endpoint call', async () => {
    const provenance = { provider: 'twelvedata', dataStatus: 'LIVE', freshness: 'FRESH', fallbackUsed: false }
    const marketOverview = { quote: { symbol: 'SPY', price: 650, provenance }, regime: { marketData: provenance, classification: { status: 'COMPLETE', trendRegime: 'BULL', riskRegime: 'RISK_ON', confidence: 85 }, inputCoverage: { available: ['price'], missing: [], stale: [] } } }
    vi.spyOn(workspaceApiClient, 'getDailyBriefing').mockResolvedValue({ briefing: briefing(), marketOverview })
    vi.spyOn(workspaceApiClient, 'getMarketOverview').mockResolvedValue(marketOverview)
    vi.spyOn(workspaceApiClient, 'getPortfolioSummary').mockResolvedValue({ summary: {} })
    vi.spyOn(workspaceApiClient, 'getWatchlist').mockResolvedValue({ quotes: [] })
    vi.spyOn(workspaceApiClient, 'getAlerts').mockResolvedValue({ alerts: [] })
    vi.spyOn(workspaceApiClient, 'getHealth').mockResolvedValue({ status: 'healthy' })
    const view = render(<DashboardSections summary={{}} />)
    await act(async () => { await new Promise((resolve) => globalThis.setTimeout(resolve, 20)) })
    expect(workspaceApiClient.getDailyBriefing).toHaveBeenCalledOnce()
    expect(workspaceApiClient.getMarketOverview).not.toHaveBeenCalled()
    expect(view.querySelector('#market-overview').textContent).toContain('$650.00')
    expect(view.querySelector('#market-overview').textContent).toContain('LIVE')
  })
})
