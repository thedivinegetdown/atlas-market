import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { selectStrategiesForRegime } from '../lib/strategies/adaptive/index.js'
import { createWorkspaceDataService } from '../lib/workspace/workspaceDataService.js'
import { createStrategySuitabilityHandler } from '../netlify/functions/strategy-suitability.js'

const NOW = '2026-07-30T20:00:00.000Z'

function regime(overrides = {}) {
  const { classification = {}, inputCoverage = {}, ...rest } = overrides
  return {
    symbol: 'SPY',
    timeframe: '1D',
    asOf: NOW,
    freshness: 'FRESH',
    engineVersion: 'market-regime-v1',
    classification: {
      trendRegime: 'BULL',
      volatilityRegime: 'NORMAL_VOLATILITY',
      riskRegime: 'RISK_ON',
      confidence: 84,
      status: 'COMPLETE',
      ...classification,
    },
    inputCoverage: {
      available: ['price', 'shortMovingAverage', 'longMovingAverage', 'rsi'],
      missing: [],
      stale: [],
      ...inputCoverage,
    },
    ...rest,
  }
}

function strategy(overrides = {}) {
  return {
    strategyId: 'index-pullback-v1',
    strategyName: 'Index Pullback',
    status: 'active',
    lifecycleState: 'active',
    validationStatus: 'valid',
    activationEligibilityStatus: 'eligible',
    ...overrides,
  }
}

function select(regimeInput = regime(), strategyInput = strategy(), context = {}) {
  return selectStrategiesForRegime({ regime: regimeInput, strategies: [strategyInput], context })
}

describe('deterministic adaptive strategy selection', () => {
  it.each([
    ['STRONG_BULL', 'CONDITIONAL'],
    ['BULL', 'ENABLED'],
    ['RANGE', 'ENABLED'],
    ['BEAR', 'CONDITIONAL'],
    ['STRONG_BEAR', 'DISABLED'],
  ])('evaluates %s trend compatibility', (trendRegime, decision) => {
    expect(select(regime({ classification: { trendRegime } })).strategies[0].decision).toBe(decision)
  })

  it.each([
    ['HIGH_VOLATILITY', 'CONDITIONAL'],
    ['NORMAL_VOLATILITY', 'ENABLED'],
    ['LOW_VOLATILITY', 'ENABLED'],
  ])('evaluates %s volatility compatibility', (volatilityRegime, decision) => {
    expect(select(regime({ classification: { volatilityRegime } })).strategies[0].decision).toBe(decision)
  })

  it.each([
    ['RISK_ON', 'ENABLED'],
    ['NEUTRAL', 'CONDITIONAL'],
    ['RISK_OFF', 'DISABLED'],
  ])('evaluates %s risk compatibility', (riskRegime, decision) => {
    expect(select(regime({ classification: { riskRegime } })).strategies[0].decision).toBe(decision)
  })

  it('handles complete, partial, insufficient, invalid, and stale regimes safely', () => {
    expect(select().strategies[0].decision).toBe('ENABLED')
    expect(select(regime({ classification: { status: 'PARTIAL' } })).strategies[0].decision).toBe('CONDITIONAL')
    expect(select(regime({ classification: { status: 'INSUFFICIENT_DATA' } })).strategies[0].decision).not.toBe('ENABLED')
    expect(select(regime({ classification: { status: 'INVALID_INPUT' } })).strategies[0].decision).not.toBe('ENABLED')
    expect(select(regime({ freshness: 'STALE', inputCoverage: { stale: ['price'] } })).strategies[0].decision).toBe('UNKNOWN')
  })

  it('identifies missing prerequisites and blocks missing safety prerequisites', () => {
    const optional = select(regime(), strategy({ requiredIndicators: ['marketBreadth'] }))
    const blocking = select(regime(), strategy({
      requiredIndicators: ['marketBreadth'],
      blockingPrerequisites: ['marketBreadth'],
    }))
    expect(optional.strategies[0]).toMatchObject({ decision: 'CONDITIONAL', missingInputs: ['marketBreadth'] })
    expect(blocking.strategies[0]).toMatchObject({ decision: 'DISABLED', missingInputs: ['marketBreadth'] })
  })

  it.each(['archived', 'paused', 'disabled'])('honors %s lifecycle authority', (lifecycleState) => {
    const result = select(regime(), strategy({ status: lifecycleState, lifecycleState }))
    expect(result.strategies[0].decision).toBe('DISABLED')
  })

  it('keeps validated modeled strategies conditional and honors blocked eligibility', () => {
    expect(select(regime(), strategy({ status: 'validated', lifecycleState: 'validated' })).strategies[0].decision).toBe('CONDITIONAL')
    expect(select(regime(), strategy({ activationEligibilityStatus: 'blocked' })).strategies[0].decision).toBe('DISABLED')
  })

  it('applies confidence thresholds and deterministic reasons', () => {
    const lowConfidence = select(regime({ classification: { confidence: 69 } }))
    expect(lowConfidence.strategies[0].decision).toBe('CONDITIONAL')
    expect(lowConfidence.strategies[0].reasons).toContain('Suitability confidence is 69')
  })

  it('returns stable serializable output for identical inputs', () => {
    expect(JSON.stringify(select())).toBe(JSON.stringify(select()))
  })

  it('ignores AI override attempts and has no provider, order, or portfolio side effects', () => {
    const provider = vi.fn()
    const createOrder = vi.fn()
    const mutatePortfolio = vi.fn()
    const result = select(
      regime({ classification: { riskRegime: 'RISK_OFF' } }),
      strategy(),
      { aiDecision: { override: 'ENABLED' }, provider, createOrder, mutatePortfolio },
    )
    expect(result.strategies[0].decision).toBe('DISABLED')
    expect(provider).not.toHaveBeenCalled()
    expect(createOrder).not.toHaveBeenCalled()
    expect(mutatePortfolio).not.toHaveBeenCalled()
    expect(result.boundaries).toEqual({ paperTradingOnly: true, advisoryOnly: true, automaticActivation: false })
  })

  it('reuses one market-overview orchestration without per-strategy candle requests', async () => {
    const marketDataService = {
      getQuote: vi.fn(),
      getCandles: vi.fn(),
      getWatchlistQuotes: vi.fn(),
    }
    const service = createWorkspaceDataService({ marketDataService })
    service.getMarketOverview = vi.fn().mockResolvedValue({ regime: regime() })
    const result = await service.getStrategySuitability('SPY', { timeframe: '1D' })
    expect(service.getMarketOverview).toHaveBeenCalledOnce()
    expect(service.getMarketOverview).toHaveBeenCalledWith('SPY', {
      timeframe: '1D',
      now: undefined,
      includeHistoricalIntelligence: true,
    })
    expect(marketDataService.getCandles).not.toHaveBeenCalled()
    expect(result.suitability.strategies).toHaveLength(3)
    expect(result.suitability.strategies[0].strategyId).toBe('index-pullback-v1')
    expect(result.suitability.strategies[1].strategyId).toBe('breakout-momentum-v1')
    expect(result.suitability.strategies[2].strategyId).toBe('range-mean-reversion-v1')
  })

  it('exposes an authenticated read-only endpoint with no raw provider evidence', async () => {
    const service = {
      getStrategySuitability: vi.fn().mockResolvedValue({
        paperTrading: true,
        advisoryOnly: true,
        suitability: select(),
      }),
    }
    const handler = createStrategySuitabilityHandler({
      serviceFactory: () => service,
      repositoryFactory: () => ({ end: vi.fn() }),
      logger: { info: vi.fn(), error: vi.fn() },
      env: {},
    })
    const unauthorized = await handler({ httpMethod: 'GET', queryStringParameters: { symbol: 'SPY' }, headers: {} })
    const authorized = await handler({
      httpMethod: 'GET',
      queryStringParameters: { symbol: 'SPY', timeframe: '1D' },
      headers: { authorization: 'Bearer private-session' },
    })
    const payload = JSON.parse(authorized.body)
    expect(unauthorized.statusCode).toBe(401)
    expect(authorized.statusCode).toBe(200)
    expect(service.getStrategySuitability).toHaveBeenCalledOnce()
    expect(JSON.stringify(payload)).not.toMatch(/candles|apikey|private-session|rawProvider/i)
    expect(payload.data.suitability.boundaries).toMatchObject({
      paperTradingOnly: true,
      advisoryOnly: true,
      automaticActivation: false,
    })
  })

  it('keeps strategy suitability evaluation behind the lazy Strategies route', () => {
    const routes = readFileSync(join(process.cwd(), 'src/AppRoutes.jsx'), 'utf8')
    const dashboard = readFileSync(join(process.cwd(), 'src/workspaces/Dashboard/dashboardSections.jsx'), 'utf8')
    expect(routes).toMatch(/lazy\(\(\) => import\('\.\/workspaces\/Strategies\/index\.jsx'\)\)/)
    expect(dashboard).not.toMatch(/useStrategySuitability|strategy-suitability/)
  })

  it('evaluates breakout momentum independently from index pullback', () => {
    const result = selectStrategiesForRegime({ regime: regime(), strategies: [{ ...strategy(), lifecycleState: 'paper_forward_observation' }, { ...strategy(), strategyId: 'breakout-momentum-v1', strategyName: 'Breakout Momentum', lifecycleState: 'paper_forward_observation' }] })
    expect(result.strategies.map(({ strategyId, decision }) => ({ strategyId, decision }))).toEqual([
      { strategyId: 'index-pullback-v1', decision: 'ENABLED' },
      { strategyId: 'breakout-momentum-v1', decision: 'ENABLED' },
    ])
  })
})
