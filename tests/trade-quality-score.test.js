import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scoreTradeQuality } from '../lib/opportunities/quality/index.js'
import { createWorkspaceDataService } from '../lib/workspace/workspaceDataService.js'
import { createTradeQualityHandler } from '../netlify/functions/trade-quality.js'

const NOW = '2026-07-30T20:00:00.000Z'

function regime(overrides = {}) {
  const { classification = {}, inputCoverage = {}, ...rest } = overrides
  return { symbol: 'AAPL', timeframe: '1D', asOf: NOW, freshness: 'FRESH', engineVersion: 'market-regime-v1', classification: { trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', confidence: 85, status: 'COMPLETE', ...classification }, inputCoverage: { available: [], missing: [], stale: [], ...inputCoverage }, ...rest }
}

function candidate(overrides = {}) {
  const { deterministicMetrics = {}, liquiditySummary = {}, volatilitySummary = {}, riskSummary = {}, ...rest } = overrides
  return { symbol: 'AAPL', asOf: NOW, direction: 'bullish', strategyId: 'index-pullback-v1', strategyName: 'Index Pullback', deterministicMetrics: { trendScore: 95, momentumScore: 95, relativeStrength: 8, relativeVolume: 1.7, atrPercentile: 55, ...deterministicMetrics }, liquiditySummary: { status: 'healthy', spreadPct: 0.05, ...liquiditySummary }, volatilitySummary: { status: 'healthy', ...volatilitySummary }, riskSummary: { rewardRiskRatio: 3.2, ...riskSummary }, ...rest }
}

function suitability(decision = 'ENABLED', overrides = {}) {
  return { strategies: [{ strategyId: 'index-pullback-v1', decision, blockingReasons: [], ...overrides }] }
}

function score(candidateInput = candidate(), regimeInput = regime(), strategyInput = suitability()) {
  return scoreTradeQuality({ candidate: candidateInput, regime: regimeInput, strategySuitability: strategyInput })
}

describe('deterministic Trade Quality Score', () => {
  it('scores an exceptional complete setup', () => {
    expect(score()).toMatchObject({ score: 99, band: 'EXCEPTIONAL', confidence: 100, status: 'COMPLETE', evidenceCoverage: 100 })
  })

  it.each([
    [90, 'EXCEPTIONAL'], [80, 'STRONG'], [70, 'QUALIFIED'], [55, 'WATCH'], [54, 'WEAK'],
  ])('maps exact score band input %i to %s', (target, expected) => {
    const weights = { regimeFit: 0, strategySuitability: 0, trend: 100, momentum: 0, relativeStrength: 0, volume: 0, volatility: 0, liquidity: 0, riskReward: 0 }
    const config = { weights, minimumCoverage: 100, minimumCoreDimensions: 0, caps: { staleOrInvalidRegime: 54, partialRegime: 69, disabledStrategy: 54, failedLiquidity: 54, blockingPrerequisite: 54 }, thresholds: { relativeStrengthStrong: 5, relativeStrengthPositive: 0, relativeVolumeStrong: 1.5, relativeVolumeConfirmed: 1, spreadMaximumPct: 0.25, riskRewardStrong: 3, riskRewardAcceptable: 2, riskRewardMinimum: 1 } }
    const result = scoreTradeQuality({ candidate: candidate({ deterministicMetrics: { trendScore: target } }), regime: regime(), strategySuitability: suitability() }, { config })
    expect(result.band).toBe(expected)
  })

  it.each([
    ['BULL', 'bullish', 15], ['BEAR', 'bearish', 15], ['RANGE', 'neutral', 15],
  ])('scores %s regime fit deterministically', (trendRegime, direction, expectedDimension) => {
    expect(score(candidate({ direction }), regime({ classification: { trendRegime } })).dimensions.regimeFit).toBe(expectedDimension)
  })

  it.each([['ENABLED', 20], ['CONDITIONAL', 13], ['DISABLED', 0]])('scores %s strategy suitability', (decision, expected) => {
    expect(score(candidate(), regime(), suitability(decision)).dimensions.strategySuitability).toBe(expected)
  })

  it('scores trend, momentum, relative strength, volume, volatility, liquidity, and risk/reward independently', () => {
    const result = score()
    expect(result.dimensions).toEqual({ regimeFit: 15, strategySuitability: 20, trend: 14, momentum: 10, relativeStrength: 10, volume: 10, volatility: 5, liquidity: 5, riskReward: 10 })
  })

  it('returns UNKNOWN when minimum evidence is absent', () => {
    expect(score({ symbol: 'AAPL', asOf: NOW }, regime(), {})).toMatchObject({ score: null, band: 'UNKNOWN', status: 'INSUFFICIENT_DATA' })
  })

  it('caps stale, invalid, partial, disabled, liquidity-failed, and blocked evidence', () => {
    expect(score(candidate(), regime({ freshness: 'STALE' })).score).toBeLessThanOrEqual(54)
    expect(score(candidate(), regime({ classification: { status: 'INVALID_INPUT' } })).score).toBeNull()
    expect(score(candidate(), regime({ classification: { status: 'PARTIAL' } })).score).toBeLessThanOrEqual(69)
    expect(score(candidate(), regime(), suitability('DISABLED')).score).toBeLessThanOrEqual(54)
    expect(score(candidate({ liquiditySummary: { status: 'thin' } })).score).toBeLessThanOrEqual(54)
    expect(score(candidate({ hardRejectionReasons: ['blocking prerequisite'] })).score).toBeLessThanOrEqual(54)
  })

  it('omits invalid risk/reward rather than improving the score and reports missing evidence', () => {
    const result = score(candidate({ riskSummary: { rewardRiskRatio: -2 } }))
    expect(result.dimensions.riskReward).toBeNull()
    expect(result.missingInputs).toContain('riskReward')
  })

  it('applies confidence penalties and returns stable deterministic reasons', () => {
    const input = candidate({ deterministicMetrics: { momentumScore: undefined }, stale: true })
    const first = score(input)
    const second = score(input)
    expect(first.confidence).toBeLessThan(100)
    expect(first.reasons).toEqual(second.reasons)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('ignores AI, provider, order, portfolio, activation, and ranking callbacks', () => {
    const sideEffects = { provider: vi.fn(), aiOverride: vi.fn(), order: vi.fn(), portfolio: vi.fn(), activate: vi.fn(), rank: vi.fn() }
    const result = scoreTradeQuality({ candidate: candidate(), regime: regime(), strategySuitability: suitability(), marketContext: sideEffects, riskContext: sideEffects })
    Object.values(sideEffects).forEach((callback) => expect(callback).not.toHaveBeenCalled())
    expect(result.boundaries).toEqual({ paperTradingOnly: true, advisoryOnly: true, automaticActivation: false, scannerRankingUnchanged: true })
  })

  it('reuses one market overview and performs no direct candle request', async () => {
    const marketDataService = { getQuote: vi.fn(), getCandles: vi.fn(), getWatchlistQuotes: vi.fn() }
    const service = createWorkspaceDataService({ marketDataService })
    service.getMarketOverview = vi.fn().mockResolvedValue({ regime: regime() })
    const result = await service.getTradeQuality(candidate(), { timeframe: '1D' })
    expect(service.getMarketOverview).toHaveBeenCalledOnce()
    expect(marketDataService.getCandles).not.toHaveBeenCalled()
    expect(result.quality.engineVersion).toBe('trade-quality-v1')
    expect(result.forwardTestEvidence).toMatchObject({
      version: 'forward-test-evidence-v1',
      symbol: 'AAPL',
      forwardTestEligible: false,
      boundaries: { paperOnly: true, automaticExecution: false, liveTrading: false },
    })
  })

  it('builds genuine scanner-derived quality context from server-side quote and existing risk evidence', async () => {
    const service = createWorkspaceDataService({ marketDataService: { getQuote: vi.fn(), getCandles: vi.fn(), getWatchlistQuotes: vi.fn() } })
    service.getMarketOverview = vi.fn().mockResolvedValue({ quote: { symbol: 'AAPL', price: 100, previousClose: 99, high: 101, low: 98, volume: 2_000_000, updatedAt: NOW, provenance: { provider: 'twelvedata', dataStatus: 'LIVE', mock: false } }, regime: regime({ marketData: { provider: 'twelvedata', dataStatus: 'LIVE', mock: false } }) })
    service.getRiskSummary = vi.fn().mockResolvedValue({ risk: { approved: true, rewardRatio: 2, stopPrice: 98, targetPrice: 104 } })
    const result = await service.getTradeQuality({ symbol: 'AAPL', asOf: NOW, scannerSource: 'Momentum Scan', assetType: 'equity' })
    expect(result.quality).toMatchObject({ opportunityId: expect.stringMatching(/^scanner-/), strategyId: 'index-pullback-v1', score: expect.any(Number), orderContext: { side: expect.any(String), price: 100, stopPrice: 98, targetPrice: 104 } })
    expect(result.quality.missingInputs).not.toContain('liquidity')
    expect(result.quality.missingInputs).not.toContain('riskReward')
    expect(result.forwardTestEvidence.blockers).not.toContain('strategy_not_enabled')
    expect(result.forwardTestEvidence.blockers).not.toContain('risk_gates_not_evaluated')
  })

  it('exposes an authenticated minimal read-only endpoint', async () => {
    const service = { getTradeQuality: vi.fn().mockResolvedValue({ paperTrading: true, advisoryOnly: true, quality: score() }) }
    const handler = createTradeQualityHandler({ serviceFactory: () => service, repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
    const unauthorized = await handler({ httpMethod: 'GET', queryStringParameters: { symbol: 'AAPL' }, headers: {} })
    const authorized = await handler({ httpMethod: 'GET', queryStringParameters: { symbol: 'AAPL', timeframe: '1D', asOf: NOW }, headers: { authorization: 'Bearer private-session' } })
    expect(unauthorized.statusCode).toBe(401)
    expect(authorized.statusCode).toBe(200)
    expect(service.getTradeQuality).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL', timeframe: 'swing' }), { timeframe: '1D' })
    expect(JSON.stringify(JSON.parse(authorized.body))).not.toMatch(/candles|apikey|private-session|rawProvider/i)
  })

  it('keeps evaluation behind the lazy Scanner route and leaves scanner ranking untouched', () => {
    const routes = readFileSync(join(process.cwd(), 'src/AppRoutes.jsx'), 'utf8')
    const evaluator = readFileSync(join(process.cwd(), 'lib/scanners/scannerEvaluator.js'), 'utf8')
    expect(routes).toMatch(/lazy\(\(\) => import\('\.\/workspaces\/Scanner\/index\.jsx'\)\)/)
    expect(evaluator).not.toMatch(/scoreTradeQuality|trade-quality/)
  })
})
