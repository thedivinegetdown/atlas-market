import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopilotSections, DecisionIntelligenceSummary, ForwardObservationStatus, RangeMeanReversionDecisionPanel, StrategyAssessments } from '../src/workspaces/AtlasCopilot/copilotSections.jsx'

vi.mock('../src/hooks/useDecisionIntelligence.js', () => ({
  useDecisionIntelligence: () => ({
    isLoading: false,
    error: null,
    intelligence: {
      market: { freshness: 'FRESH', status: 'AVAILABLE', context: { participation: { status: 'MIXED' }, sectorLeadership: { leaders: [], laggards: [] } } },
      opportunities: { qualifiedCount: 0, watchCount: 0, emptyQualifiedState: 'NO_QUALIFIED_OPPORTUNITIES', topQualifiedPlans: [], watchPlans: [] },
      decisionQuality: { status: 'INSUFFICIENT_SAMPLE', recentTrend: 'INSUFFICIENT_DATA' },
      evidence: { empiricalConfidence: 'UNAVAILABLE' },
      portfolio: { exposure: { status: 'UNAVAILABLE' } },
      strategyAssessments: [
        { strategyId: 'index-pullback-v1', status: 'NO_TRADE' },
        { strategyId: 'breakout-momentum-v1', status: 'NO_TRADE' },
        { strategyId: 'range-mean-reversion-v1', status: 'NO_TRADE' },
        { strategyId: 'volatility-expansion-v1', status: 'NO_TRADE' },
      ],
      observations: [
        { experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', status: 'NOT_STARTED' },
        { experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', status: 'NOT_STARTED' },
        { experimentId: 'RANGE.1', strategyId: 'range-mean-reversion-v1', status: 'NOT_STARTED' },
        { experimentId: 'VOL.1', strategyId: 'volatility-expansion-v1', status: 'NOT_STARTED' },
      ],
      copilotContext: { selectedPlan: null, portfolioAdmission: null, decisionQuality: { status: 'INSUFFICIENT_SAMPLE' } },
    },
  }),
}))

let root; let container
function render(element) { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(element)); return container }
afterEach(() => { act(() => root?.unmount()); container?.remove() })
describe('Decision Intelligence workspace summary', () => {
  it('renders the production-shaped lazy Copilot and all governed decision evidence', async () => {
    const view = render(<CopilotSections />)
    await vi.waitFor(() => expect(view.textContent).toContain('Submit'))
    expect(view.textContent).toContain('index-pullback-v1')
    expect(view.textContent).toContain('breakout-momentum-v1')
    expect(view.textContent).toContain('range-mean-reversion-v1')
    expect(view.textContent).toContain('volatility-expansion-v1')
    expect(view.textContent).toContain('EDGE.2')
    expect(view.textContent).toContain('BREAKOUT.1')
    expect(view.textContent).toContain('RANGE.1')
    expect(view.textContent).toContain('VOL.1')
    expect(view.textContent).not.toContain('Feature panel could not be loaded safely')
  })
  it('renders qualified and watch evidence while preserving disabled execution', () => {
    const view = render(<DecisionIntelligenceSummary state={{ isLoading: false, intelligence: { market: { freshness: 'FRESH', status: 'AVAILABLE', context: { participation: { status: 'MIXED', labels: { display: 'SECTOR ETF PARTICIPATION PROXY' } }, sectorLeadership: { leaders: [{ symbol: 'XLK' }], laggards: [{ symbol: 'XLF' }] } } }, opportunities: { qualifiedCount: 1, watchCount: 1, topQualifiedPlans: [{ symbol: 'AAPL', side: 'long', strategyId: 'index-pullback-v1', rankingScore: 80, planReference: { planId: 'plan-a' }, portfolioEvidence: { status: 'AVAILABLE' } }], watchPlans: [{ symbol: 'IWM' }] }, decisionQuality: { status: 'INSUFFICIENT_SAMPLE', recentTrend: 'INSUFFICIENT_DATA', overall: { expectancy: 0 }, rNormalized: { metrics: null } }, evidence: { empiricalConfidence: 'UNAVAILABLE' }, portfolio: { exposure: { status: 'UNAVAILABLE' } } } }} />)
    expect(view.textContent).toContain('AAPL'); expect(view.textContent).toContain('WATCH: IWM'); expect(view.textContent).toContain('SECTOR ETF PARTICIPATION PROXY'); expect(view.textContent).toContain('Live execution disabled'); expect(view.textContent).toContain('empirical confidence UNAVAILABLE')
  })
  it('renders the explicit no-qualified state without filling it from watch plans', () => {
    const view = render(<DecisionIntelligenceSummary state={{ isLoading: false, intelligence: { market: {}, opportunities: { qualifiedCount: 0, watchCount: 1, emptyQualifiedState: 'NO_QUALIFIED_OPPORTUNITIES', watchPlans: [{ symbol: 'IWM' }] }, decisionQuality: {}, evidence: {}, portfolio: { exposure: {} } } }} />)
    expect(view.textContent).toContain('NO QUALIFIED OPPORTUNITIES'); expect(view.textContent).toContain('WATCH: IWM')
  })
  it('renders both bounded forward-observation states without cohort controls', () => {
    const view = render(<ForwardObservationStatus observations={[{ experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', status: 'COLLECTING', sessionsElapsed: 3, completedOutcomes: 1, minimumSessions: 20, minimumOutcomes: 30 }, { experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', status: 'INVALIDATED', sessionsElapsed: 2, completedOutcomes: 0, minimumSessions: 20, minimumOutcomes: 30, reason: 'persisted_manifest_definition_mismatch' }]} />)
    expect(view.textContent).toContain('EDGE.2'); expect(view.textContent).toContain('BREAKOUT.1'); expect(view.textContent).toContain('Sessions: 3 / 20'); expect(view.textContent).toContain('Outcomes: 0 / 30'); expect(view.textContent).toContain('INVALIDATED')
    expect(view.textContent).not.toMatch(/start|reset|force eligibility/i)
  })
  it('renders RANGE.1 as a third independent read-only observation row', () => {
    const view = render(<ForwardObservationStatus observations={[{ experimentId: 'RANGE.1', strategyId: 'range-mean-reversion-v1', status: 'NOT_STARTED', sessionsElapsed: 0, completedOutcomes: 0, minimumSessions: 20, minimumOutcomes: 30 }]} />)
    expect(view.textContent).toContain('Range Mean Reversion'); expect(view.textContent).toContain('RANGE.1'); expect(view.textContent).toContain('NOT STARTED'); expect(view.textContent).not.toMatch(/start cohort|force start/i)
  })
  it('renders VOL.1 as a volatility expansion observation row', () => {
    const view = render(<ForwardObservationStatus observations={[{ experimentId: 'VOL.1', strategyId: 'volatility-expansion-v1', status: 'COLLECTING' }]} />)
    expect(view.textContent).toContain('Volatility Expansion'); expect(view.textContent).toContain('VOL.1')
  })
  it('renders deterministic strategy assessments without controls', () => {
    const view = render(<StrategyAssessments assessments={[{ strategyId: 'volatility-expansion-v1', status: 'NO_TRADE', noTradeReason: 'Risk sizing allowed zero quantity.' }]} />)
    expect(view.textContent).toContain('volatility-expansion-v1'); expect(view.textContent).toContain('NO TRADE'); expect(view.textContent).toContain('Risk sizing allowed zero quantity.'); expect(view.textContent).not.toMatch(/execute|start|force/i)
  })
  it('renders bounded range candidate evidence without execution controls', () => {
    const view = render(<RangeMeanReversionDecisionPanel plan={{ strategy: { suitability: 'ENABLED' }, decision: { status: 'QUALIFIED' }, structure: { entry: 100, stop: 92.5, target: 110, rMultiple: 1.33 }, risk: { allowedQuantity: 2 }, rangeMeanReversion: { currentPrice: 100, sma20: 110, stretchAtr: 1, prior20Low: 90, adx14: 19, rsi14: 35, relativeVolume: 1, relativeStrength: -1, marketParticipation: 'MIXED', sectorAlignment: 'UNAVAILABLE' } }} />)
    expect(view.textContent).toContain('Prior 20-session Low'); expect(view.textContent).toContain('ATR Stretch'); expect(view.textContent).toContain('Entry:'); expect(view.textContent).toContain('Target:'); expect(view.textContent).not.toMatch(/execute|start|force/i)
  })
})
