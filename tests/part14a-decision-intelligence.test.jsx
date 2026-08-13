import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import {
  LiquidityScorer,
  MomentumScorer,
  PortfolioExposureScorer,
  RiskScorer,
  TrendScorer,
  VolatilityScorer,
} from '../lib/decision/scorers.js'
import { DECISION_ACTIONS } from '../lib/decision/decisionActions.js'
import { createDecisionEngine } from '../lib/decision/decisionEngine.js'
import { handler as decisionHandler } from '../netlify/functions/decision.js'
import { auth2Headers, auth2Query } from './helpers/auth2Fixtures.js'
import { DecisionPanel } from '../src/components/panels.jsx'

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

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    json: JSON.parse(response.body),
  }
}

function baseContext(overrides = {}) {
  return {
    quote: {
      symbol: 'AAPL',
      assetType: 'equity',
      price: 100,
      changePercent: 2.1,
      volume: 1800000,
      atr: 1.4,
    },
    signal: {
      action: 'BUY',
      confidence: 82,
      trendDirection: 'Up',
      momentum: 6,
      bullScore: 78,
      bearScore: 22,
    },
    risk: {
      approved: true,
      checks: [{ passed: true }, { passed: true }],
      positionSize: 25,
      stopDistance: 2,
      stopPrice: 98,
      targetPrice: 104,
      accountExposure: 2.5,
      buyingPowerImpact: 2.5,
    },
    scannerMatches: [{ symbol: 'AAPL', matchedCriteria: ['signal_bullish'] }],
    portfolio: { accountValue: 100000, cash: 100000, openRisk: 500, exposure: 0.12 },
    positions: [],
    assetProfile: { assetType: 'equity', quantityLabel: 'shares' },
    ...overrides,
  }
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 14A decision intelligence engine', () => {
  it('scores every modular component', () => {
    const context = baseContext()

    expect(new TrendScorer().score(context)).toMatchObject({ label: 'bullish', score: expect.any(Number) })
    expect(new MomentumScorer().score(context)).toMatchObject({ label: 'positive', score: expect.any(Number) })
    expect(new RiskScorer().score(context)).toMatchObject({ label: 'acceptable', score: expect.any(Number) })
    expect(new VolatilityScorer().score(context)).toMatchObject({ label: 'controlled', score: expect.any(Number) })
    expect(new LiquidityScorer().score(context)).toMatchObject({ label: 'liquid', score: expect.any(Number) })
    expect(new PortfolioExposureScorer().score(context)).toMatchObject({ label: 'clear', score: expect.any(Number) })
  })

  it('creates a strong bullish decision with explainability and a trade plan', () => {
    const decision = createDecisionEngine({ now: () => new Date('2026-01-01T12:00:00Z') }).evaluate(baseContext())

    expect(decision.recommendedAction).toBe(DECISION_ACTIONS.STRONG_BUY)
    expect(decision.overallScore).toBeGreaterThanOrEqual(85)
    expect(decision.positiveFactors.length).toBeGreaterThan(0)
    expect(decision.recommendedPositionSize).toBe(25)
    expect(decision.recommendedStop).toBe(98)
    expect(decision.recommendedTarget).toBe(104)
    expect(decision.riskRewardRatio).toBe(2)
    expect(decision.confidenceExplanation).toContain('Confidence')
  })

  it('returns watch or neutral for weak conflicting data', () => {
    const decision = createDecisionEngine().evaluate(baseContext({
      quote: { symbol: 'AAPL', assetType: 'equity', price: 100, changePercent: -0.2, volume: 350000, atr: 2.5 },
      signal: { action: 'HOLD', confidence: 45, trendDirection: 'Flat', momentum: 0, bullScore: 50, bearScore: 50 },
      scannerMatches: [],
    }))

    expect([DECISION_ACTIONS.WATCH, DECISION_ACTIONS.NEUTRAL]).toContain(decision.recommendedAction)
    expect(decision.overallScore).toBeGreaterThan(40)
  })

  it('avoids high-risk setups and preserves warnings', () => {
    const decision = createDecisionEngine().evaluate(baseContext({
      risk: {
        approved: false,
        reason: 'risk limit exceeded',
        checks: [{ passed: false, reason: 'risk limit exceeded' }],
        positionSize: 0,
        stopDistance: 8,
        stopPrice: 92,
        targetPrice: 108,
        accountExposure: 35,
        buyingPowerImpact: 40,
      },
    }))

    expect(decision.recommendedAction).toBe(DECISION_ACTIONS.AVOID)
    expect(decision.riskScore).toBeLessThanOrEqual(25)
    expect(decision.warnings.join(' ')).toContain('risk limit exceeded')
  })

  it('handles missing data with a conservative decision object', () => {
    const decision = createDecisionEngine().evaluate({})

    expect(decision.overallScore).toBeGreaterThanOrEqual(0)
    expect(decision.recommendedAction).toBeDefined()
    expect(decision.timestamp).toBeDefined()
  })

  it('returns decision API success and invalid symbol responses', async () => {
    const success = parseResponse(await decisionHandler({ headers: auth2Headers(), queryStringParameters: auth2Query({ symbol: 'spy' }) }))
    const invalid = parseResponse(await decisionHandler({ headers: auth2Headers(), queryStringParameters: auth2Query({ symbol: '$bad' }) }))

    expect(success.statusCode).toBe(200)
    expect(success.json).toMatchObject({
      ok: true,
      data: {
        paperTrading: true,
        symbol: 'SPY',
        decision: {
          overallDecision: expect.any(String),
          recommendedAction: expect.any(String),
        },
      },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json).toMatchObject({
      ok: false,
      error: { code: 'invalid_symbol' },
    })
  })

  it('renders DecisionPanel content and empty, loading, and error states', () => {
    const decision = createDecisionEngine({ now: () => new Date('2026-01-01T12:00:00Z') }).evaluate(baseContext())

    renderWithRoot(<DecisionPanel symbol="AAPL" decision={decision} assetProfile={{ quantityLabel: 'shares' }} />)
    expect(container.textContent).toContain('Decision Intelligence')
    expect(container.textContent).toContain(decision.overallDecision)
    expect(container.textContent).toContain('Positive Factors')

    act(() => {
      root.render(<DecisionPanel symbol="" decision={null} />)
    })
    expect(container.textContent).toContain('Select a symbol')

    act(() => {
      root.render(<DecisionPanel symbol="AAPL" decision={null} loading />)
    })
    expect(container.textContent).toContain('Loading decision intelligence')

    act(() => {
      root.render(<DecisionPanel symbol="AAPL" decision={null} error="Decision unavailable" />)
    })
    expect(container.textContent).toContain('Decision unavailable')
  })
})
