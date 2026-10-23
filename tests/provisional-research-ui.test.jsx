import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ResearchWorkspace from '../src/workspaces/Research/ResearchWorkspace.jsx'
import SymbolResearchWorkspace from '../src/workspaces/Research/SymbolResearchWorkspace.jsx'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import { researchOverview } from './helpers/provisionalResearchFixtures.js'
let root, container
function render(element) { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(element)) }
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.restoreAllMocks() })
describe('Research estimate rendering', () => {
  it('renders labeled estimates, separate LIVE quote, source cutoffs and local timeframe controls', () => {
    render(<SymbolResearchWorkspace symbol="AAPL" initialOverview={researchOverview()} autoLoad={false} />)
    expect(container.textContent).toContain('PROVISIONAL RESEARCH — NOT GOVERNED EVIDENCE')
    expect(container.textContent).toContain('Completion UNKNOWN')
    expect(container.textContent).toContain('Retrieved:')
    expect(container.textContent).toContain('provider session label Oct 19, 2026')
    expect(container.querySelector('[aria-label="Market data status LIVE"]')).not.toBeNull()
    expect(container.querySelectorAll('.research-chart__volume')).toHaveLength(66)
    expect(container.querySelector('#symbol-research-trend').textContent).not.toContain('INSUFFICIENT')
    act(() => container.querySelector('.research-timeframes button').click())
    expect(container.querySelectorAll('.research-chart__volume')).toHaveLength(22)
    act(() => container.querySelector('.research-timeframes button:last-child').click())
    expect(container.querySelectorAll('.research-chart__volume')).toHaveLength(259)
    expect(container.querySelector('#symbol-research-scanner').textContent).toContain('UNAVAILABLE')
    expect(container.querySelector('form')).toBeNull()
  })
  it('ignores mismatched estimate cutoffs instead of presenting stale values', () => {
    const data = structuredClone(researchOverview()); data.provisionalResearch.estimates.inputCutoff = '2026-10-20'
    render(<SymbolResearchWorkspace symbol="AAPL" initialOverview={data} autoLoad={false} />)
    expect(container.querySelector('.research-chart')).toBeNull()
    expect(container.querySelector('#symbol-research-trend').textContent).toContain('INSUFFICIENT')
  })
  it('loads the actual direct-link route once through the Research-only endpoint', async () => {
    vi.spyOn(workspaceApiClient, 'getResearchHistory').mockResolvedValue(researchOverview())
    vi.spyOn(workspaceApiClient, 'getMarketOverview')
    vi.spyOn(workspaceApiClient, 'getGovernedReviewPreparationStatus').mockResolvedValue({ observationCoverage: { checks: [] } })
    render(<MemoryRouter initialEntries={['/research/AAPL']}><Routes><Route path="/research/:symbol" element={<ResearchWorkspace />} /></Routes></MemoryRouter>)
    await vi.waitFor(() => expect(container.querySelector('.research-chart')).not.toBeNull())
    expect(workspaceApiClient.getResearchHistory).toHaveBeenCalledExactlyOnceWith('AAPL', { skipQuote: false })
    expect(workspaceApiClient.getMarketOverview).not.toHaveBeenCalled()
  })
})
