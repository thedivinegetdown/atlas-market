import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildDailyBriefing } from '../lib/intelligence/briefing/index.js'
import { createWorkspaceDataService } from '../lib/workspace/workspaceDataService.js'
import { createDailyBriefingHandler } from '../netlify/functions/daily-briefing.js'

const NOW = '2026-07-30T20:00:00.000Z'
function regime(overrides = {}) { const { classification = {}, ...rest } = overrides; return { asOf: NOW, freshness: 'FRESH', classification: { trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', confidence: 85, status: 'COMPLETE', ...classification }, inputCoverage: { available: [], missing: [], stale: [] }, ...rest } }
function strategies(overrides = {}) { return { status: 'COMPLETE', summary: { enabled: 1, conditional: 0, disabled: 0, unknown: 0 }, strategies: [{ strategyId: 'index-pullback-v1', strategyName: 'Index Pullback', decision: 'ENABLED', confidence: 82 }], ...overrides } }
function portfolio(overrides = {}) { return { summary: { accountValue: 100000, openRisk: 500, maxDrawdown: 2, concentration: 20, riskTier: 'NORMAL', ...overrides } } }
function base(overrides = {}) { return { regime: regime(), strategySuitability: strategies(), opportunities: [], portfolioRisk: portfolio(), alerts: [], operations: { status: 'HEALTHY', provider: 'mock', providerStatus: 'HEALTHY' }, ...overrides } }

describe('deterministic Daily Briefing', () => {
  it('returns READY for complete healthy evidence', () => expect(buildDailyBriefing(base()).status).toBe('READY'))
  it('returns CAUTION for conditional strategy evidence', () => expect(buildDailyBriefing(base({ strategySuitability: strategies({ summary: { enabled: 0, conditional: 1, disabled: 0, unknown: 0 } }) })).status).toBe('CAUTION'))
  it('returns BLOCKED for critical evidence', () => expect(buildDailyBriefing(base({ alerts: [{ id: 'a', severity: 'critical', lifecycle: 'open' }] })).status).toBe('BLOCKED'))
  it('returns INSUFFICIENT_DATA when core evidence is missing', () => expect(buildDailyBriefing(base({ strategySuitability: undefined })).status).toBe('INSUFFICIENT_DATA'))
  it('aggregates market regimes and freshness', () => expect(buildDailyBriefing(base()).market).toMatchObject({ trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', confidence: 85, freshness: 'FRESH' }))
  it('aggregates strategy counts and confidence', () => expect(buildDailyBriefing(base()).strategies).toMatchObject({ enabled: 1, conditional: 0, averageConfidence: 82 }))
  it('bounds and summarizes reviewed Trade Quality results', () => {
    const result = buildDailyBriefing(base({ opportunities: Array.from({ length: 5 }, (_, index) => ({ symbol: `A${index}`, score: 90 - index, band: 'EXCEPTIONAL', confidence: 80, status: 'COMPLETE', freshness: 'FRESH', reasons: ['Evidence aligned'] })) }))
    expect(result.opportunities).toHaveLength(3)
    expect(result.opportunities[0]).toMatchObject({ symbol: 'A0', score: 90, confidence: 80 })
  })
  it('aggregates portfolio risk without inventing fields', () => expect(buildDailyBriefing(base()).portfolioRisk).toMatchObject({ available: true, openRisk: 500, drawdown: 2, concentration: 20 }))
  it('prioritizes critical alerts', () => expect(buildDailyBriefing(base({ alerts: [{ id: 'critical', severity: 'critical' }] })).priorities[0]).toMatchObject({ level: 'CRITICAL', source: 'alerts' }))
  it('creates HIGH opportunity review priority', () => expect(buildDailyBriefing(base({ opportunities: [{ symbol: 'AAPL', score: 85, band: 'STRONG', confidence: 80, status: 'COMPLETE' }] })).priorities.some((item) => item.level === 'HIGH')).toBe(true))
  it('creates MEDIUM conditional strategy priority', () => expect(buildDailyBriefing(base({ strategySuitability: strategies({ summary: { enabled: 0, conditional: 1, disabled: 0, unknown: 0 } }) })).priorities.some((item) => item.level === 'MEDIUM')).toBe(true))
  it('creates LOW and INFORMATIONAL priorities', () => {
    expect(buildDailyBriefing(base({ alerts: [{ id: 'info', severity: 'informational' }] })).priorities[0].level).toBe('LOW')
    expect(buildDailyBriefing(base()).priorities[0].level).toBe('INFORMATIONAL')
  })
  it('blocks stale critical market evidence', () => expect(buildDailyBriefing(base({ regime: regime({ freshness: 'STALE' }) })).status).toBe('BLOCKED'))
  it('blocks invalid regime evidence', () => expect(buildDailyBriefing(base({ regime: regime({ classification: { status: 'INVALID_INPUT' } }) })).status).toBe('BLOCKED'))
  it('reports missing strategy data', () => expect(buildDailyBriefing(base({ strategySuitability: null })).coverage.strategies).toBe(false))
  it('permits an empty reviewed-opportunity set without fabrication', () => expect(buildDailyBriefing(base()).opportunities).toEqual([]))
  it('reports missing portfolio data', () => expect(buildDailyBriefing(base({ portfolioRisk: null })).coverage.portfolioRisk).toBe(false))
  it('prioritizes provider degradation', () => expect(buildDailyBriefing(base({ operations: { status: 'DEGRADED', provider: 'existing-provider', providerStatus: 'DEGRADED' } })).priorities[0]).toMatchObject({ level: 'HIGH', source: 'operations' }))
  it('returns stable ordering for identical input', () => expect(JSON.stringify(buildDailyBriefing(base({ alerts: [{ id: 'b', severity: 'high' }, { id: 'a', severity: 'high' }] })))).toBe(JSON.stringify(buildDailyBriefing(base({ alerts: [{ id: 'b', severity: 'high' }, { id: 'a', severity: 'high' }] })))))
  it('caps priorities at five', () => expect(buildDailyBriefing(base({ alerts: Array.from({ length: 8 }, (_, index) => ({ id: `${index}`, severity: 'critical' })) })).priorities).toHaveLength(5))
  it('excludes prohibited execution language', () => {
    const result = buildDailyBriefing(base({ alerts: [{ id: 'a', severity: 'high', message: 'Buy now' }], opportunities: [{ symbol: 'AAPL', score: 90, status: 'COMPLETE', reasons: ['Sell now'] }] }))
    expect(JSON.stringify(result)).not.toMatch(/\b(buy|sell|enter trade|exit trade|guaranteed opportunity)\b/i)
  })
  it('does not call providers, AI, orders, or portfolio mutation from the engine', () => {
    const callbacks = { provider: vi.fn(), ai: vi.fn(), order: vi.fn(), portfolioMutation: vi.fn() }
    buildDailyBriefing({ ...base(), ...callbacks })
    Object.values(callbacks).forEach((callback) => expect(callback).not.toHaveBeenCalled())
  })
  it('reuses one historical market overview without direct duplicate candle requests', async () => {
    const marketDataService = { getQuote: vi.fn(), getCandles: vi.fn(), getWatchlistQuotes: vi.fn() }
    const service = createWorkspaceDataService({ marketDataService })
    service.getMarketOverview = vi.fn().mockResolvedValue({ quote: { provider: 'mock', health: { available: true } }, regime: regime() })
    service.getPortfolioSummary = vi.fn().mockResolvedValue(portfolio())
    service.listAlerts = vi.fn().mockResolvedValue({ alerts: [] })
    await service.getDailyBriefing('SPY')
    expect(service.getMarketOverview).toHaveBeenCalledOnce()
    expect(service.getMarketOverview).toHaveBeenCalledWith('SPY', { timeframe: '1D', now: undefined, includeHistoricalIntelligence: true })
    expect(marketDataService.getCandles).not.toHaveBeenCalled()
  })
  it('exposes an authenticated compact endpoint', async () => {
    const service = { getDailyBriefing: vi.fn().mockResolvedValue({ briefing: buildDailyBriefing(base()) }) }
    const opportunityRepository = { listTradeQualityReviews: vi.fn().mockResolvedValue([]), listPaperEvaluations: vi.fn().mockResolvedValue([]) }
    const organizationMembershipRepository = { getMembership: vi.fn().mockResolvedValue({ organizationId: 'org-atlas-local', userId: 'local-development:local-operator', role: 'owner', status: 'active' }) }
    const handler = createDailyBriefingHandler({ serviceFactory: () => service, opportunityRepository, organizationMembershipRepository, repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
    expect((await handler({ httpMethod: 'GET', queryStringParameters: {}, headers: {} })).statusCode).toBe(401)
    const response = await handler({ httpMethod: 'GET', queryStringParameters: { symbol: 'SPY', organizationId: 'org-atlas-local', accountId: 'paper-portfolio' }, headers: { authorization: 'Bearer private-session' } })
    expect(response.statusCode).toBe(200)
    expect(opportunityRepository.listTradeQualityReviews).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'paper-portfolio', limit: 3, tenantContext: expect.objectContaining({ organizationId: 'org-atlas-local' }) }))
    expect(JSON.stringify(JSON.parse(response.body))).not.toMatch(/candles|apikey|private-session|rawProvider/i)
  })
  it('keeps briefing requests behind the lazy Dashboard route', () => {
    const routes = readFileSync(join(process.cwd(), 'src/AppRoutes.jsx'), 'utf8')
    const scanner = readFileSync(join(process.cwd(), 'src/workspaces/Scanner/scannerSections.jsx'), 'utf8')
    expect(routes).toMatch(/lazy\(\(\) => import\('\.\/workspaces\/Dashboard\/index\.jsx'\)\)/)
    expect(scanner).not.toMatch(/useDailyBriefing|daily-briefing/)
  })
  it('preserves paper-only and advisory-only boundaries', () => expect(buildDailyBriefing(base()).boundaries).toEqual({ advisoryOnly: true, paperTradingOnly: true, automaticActions: false }))
})
