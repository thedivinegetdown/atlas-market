import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DecisionIntelligenceSummary } from '../src/workspaces/AtlasCopilot/copilotSections.jsx'

let root; let container
function render(element) { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(element)); return container }
afterEach(() => { act(() => root?.unmount()); container?.remove() })
describe('Decision Intelligence workspace summary', () => {
  it('renders qualified and watch evidence while preserving disabled execution', () => {
    const view = render(<DecisionIntelligenceSummary state={{ isLoading: false, intelligence: { market: { freshness: 'FRESH', status: 'AVAILABLE' }, opportunities: { qualifiedCount: 1, watchCount: 1, topQualifiedPlans: [{ symbol: 'AAPL', side: 'long', strategyId: 'index-pullback-v1', rankingScore: 80, planReference: { planId: 'plan-a' }, portfolioEvidence: { status: 'AVAILABLE' } }], watchPlans: [{ symbol: 'IWM' }] }, decisionQuality: { status: 'INSUFFICIENT_SAMPLE', recentTrend: 'INSUFFICIENT_DATA', overall: { expectancy: 0 }, rNormalized: { metrics: null } }, evidence: { empiricalConfidence: 'UNAVAILABLE' }, portfolio: { exposure: { status: 'UNAVAILABLE' } } } }} />)
    expect(view.textContent).toContain('AAPL'); expect(view.textContent).toContain('WATCH: IWM'); expect(view.textContent).toContain('Live execution disabled'); expect(view.textContent).toContain('empirical confidence UNAVAILABLE')
  })
  it('renders the explicit no-qualified state without filling it from watch plans', () => {
    const view = render(<DecisionIntelligenceSummary state={{ isLoading: false, intelligence: { market: {}, opportunities: { qualifiedCount: 0, watchCount: 1, emptyQualifiedState: 'NO_QUALIFIED_OPPORTUNITIES', watchPlans: [{ symbol: 'IWM' }] }, decisionQuality: {}, evidence: {}, portfolio: { exposure: {} } } }} />)
    expect(view.textContent).toContain('NO QUALIFIED OPPORTUNITIES'); expect(view.textContent).toContain('WATCH: IWM')
  })
})