import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createPortfolioIntelligenceRepository,
  evaluatePortfolioHealth,
  evaluatePortfolioIntelligence,
  generatePortfolioInsights,
  validatePortfolioHistoryFilters,
} from '../lib/portfolio/portfolioIntelligenceEngine.js'
import { API_ROUTE_REGISTRY } from '../lib/system/apiReliabilityEngine.js'
import { buildMigrationSql } from '../lib/db/migrations.js'
import { createAtlasPortfolioIntelligenceHandler } from '../netlify/functions/atlas-portfolio-intelligence.js'
import { AtlasPortfolioIntelligencePanel } from '../src/components/AtlasPortfolioIntelligencePanel.jsx'

const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId: 'local-development:user-1', role: 'analyst' }

function position(extra = {}) {
  return {
    symbol: extra.symbol ?? 'AAPL',
    assetType: extra.assetType ?? 'equity',
    sector: extra.sector ?? 'Technology',
    quantity: extra.quantity ?? 20,
    averagePrice: extra.averagePrice ?? 180,
    currentPrice: extra.currentPrice ?? 190,
    marketValue: extra.marketValue ?? 3800,
    unrealizedPnl: extra.unrealizedPnl ?? 200,
    realizedPnl: extra.realizedPnl ?? 50,
    volatility: extra.volatility ?? 20,
    liquidityScore: extra.liquidityScore ?? 85,
    asOf: extra.asOf ?? '2026-07-20T10:00:00.000Z',
    missingData: extra.missingData ?? [],
    ...extra,
  }
}

function portfolio(extra = {}) {
  return {
    portfolioId: 'paper-portfolio',
    accountValue: 100000,
    cash: 50000,
    tenantContext,
    accountId: 'paper-portfolio',
    positions: [
      position(),
      position({ symbol: 'SPY', assetType: 'etf', sector: 'Index', marketValue: 9000, volatility: 12 }),
      position({ symbol: 'MSFT', sector: 'Technology', marketValue: 4200, missingData: ['fresh volatility'] }),
    ],
    watchlist: [{ symbol: 'AAPL' }, { symbol: 'NVDA' }],
    signals: [{ symbol: 'AAPL', signal: 'watch' }],
    opportunities: [{ symbol: 'AAPL', rankingTier: 'review' }],
    ...extra,
  }
}

function authEvent(body = {}, role = 'analyst', query = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer dev-token',
      'x-request-id': 'req-88',
      'content-type': 'application/json',
      'x-csrf-token': 'dev-csrf-token',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'user-1',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', ...query },
    body: JSON.stringify(body),
  }
}

function parse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function membership(role = 'analyst', organizationId = 'org-atlas-local') {
  return {
    getMembership: vi.fn(async (requestedOrganizationId) => requestedOrganizationId === organizationId
      ? { role, organizationId, userId: 'local-development:user-1', status: 'active', id: `membership-${role}` }
      : null),
  }
}

function MetricCard({ label, value }) {
  return React.createElement('article', null, React.createElement('span', null, label), React.createElement('strong', null, value))
}

describe('Phase 88A-C deterministic portfolio health and risk summary', () => {
  it('computes deterministic bounded health, diversification, concentration, allocation, PnL, volatility, exposure, and confidence metadata', () => {
    const first = evaluatePortfolioHealth(portfolio(), { timestamp: '2026-07-20T11:00:00.000Z' })
    const second = evaluatePortfolioHealth(portfolio(), { timestamp: '2026-07-20T11:00:00.000Z' })
    expect(first.healthScore).toBe(second.healthScore)
    expect(first.healthScore).toBeGreaterThanOrEqual(0)
    expect(first.healthScore).toBeLessThanOrEqual(100)
    expect(first.diversificationScore).toBeGreaterThan(0)
    expect(first.concentrationScore).toBeGreaterThan(0)
    expect(first.sectorAllocation[0]).toHaveProperty('weight')
    expect(first.symbolAllocation[0]).toHaveProperty('symbol')
    expect(first.unrealizedPnlSummary.total).toBe(600)
    expect(first.realizedPnlSummary.total).toBe(150)
    expect(first.portfolioVolatilityEstimate).toBeGreaterThan(0)
    expect(first.exposureSummary.grossExposure).toBeGreaterThan(0)
    expect(first.confidence).toBeGreaterThanOrEqual(0)
    expect(first.confidence).toBeLessThanOrEqual(1)
    expect(first.confidenceMetadata.aiGeneratedMath).toBe(false)
  })

  it('rejects malformed portfolio data and detects stale positions and missing data', () => {
    expect(() => evaluatePortfolioHealth(null)).toThrow('portfolio input is invalid')
    expect(() => evaluatePortfolioHealth({ accountValue: 'not-a-number', positions: [] })).toThrow('portfolio account value is invalid')
    expect(() => evaluatePortfolioHealth({ accountValue: 1000, positions: [{ symbol: 'BAD SYMBOL', quantity: 1 }] })).toThrow('portfolio symbol is invalid')
    const result = evaluatePortfolioHealth(portfolio({ positions: [position({ asOf: '2026-07-18T10:00:00.000Z', missingData: ['quote'] })] }), { timestamp: '2026-07-20T12:00:00.000Z' })
    expect(result.stalePositions).toHaveLength(1)
    expect(result.missingData).toEqual([{ symbol: 'AAPL', field: 'quote' }])
    expect(result.riskSummary.limitations.join(' ')).toContain('missing')
  })

  it('penalizes concentration and improves diversification with broader holdings', () => {
    const concentrated = evaluatePortfolioHealth(portfolio({ positions: [position({ marketValue: 80000 })] }))
    const diversified = evaluatePortfolioHealth(portfolio())
    expect(concentrated.concentrationScore).toBeGreaterThan(diversified.concentrationScore)
    expect(diversified.diversificationScore).toBeGreaterThanOrEqual(concentrated.diversificationScore)
  })
})

describe('Phase 88B AI portfolio insights', () => {
  it('separates observed data from interpretation and preserves advisory paper-only notices without trade recommendations', async () => {
    const insights = await generatePortfolioInsights(portfolio(), {
      atlasAiGateway: {
        run: vi.fn(async () => ({
          atlasAiRequest: { status: 'completed', evaluation: { overallStatus: 'passed', warnings: [] } },
          atlasAiResponse: {
            summary: 'Diversification and concentration were reviewed.',
            observations: ['Observed paper portfolio context was summarized.'],
            risks: ['Technology concentration requires review.'],
            recommendations: ['Research sector allocation and stale data.'],
            limitations: ['Advisory only.'],
          },
          providerHealth: { status: 'healthy', provider: 'mock' },
        })),
      },
    })
    expect(insights.observedData.positionCount).toBe(3)
    expect(insights.interpretation.summary).toContain('Diversification')
    expect(insights.advisoryOnlyNotice).toContain('Advisory analysis only')
    expect(insights.paperTradingOnlyNotice).toContain('Paper trading only')
    expect(insights.tradeRecommendations).toBe(false)
    expect(insights.pricePredictions).toBe(false)
    expect(insights.guaranteedOutcomes).toBe(false)
    expect(JSON.stringify(insights)).not.toMatch(/buy now|guaranteed profit|risk-free/i)
  })

  it('returns degraded AI insights when the provider is unavailable while deterministic health remains available', async () => {
    const result = await evaluatePortfolioIntelligence(portfolio(), {
      atlasAiGateway: { run: vi.fn(async () => { throw new Error('provider failed with stack') }) },
      emitEvent: false,
    })
    expect(result.status).toBe('degraded')
    expect(result.healthScore).toBeGreaterThanOrEqual(0)
    expect(result.aiInsights.status).toBe('degraded')
    expect(result.aiInsights.liveOrders).toBe(false)
    expect(result.aiInsights.brokerExecution).toBe(false)
  })
})

describe('Phase 88E portfolio history API and persistence', () => {
  it('validates pagination and filters for history snapshots', () => {
    expect(validatePortfolioHistoryFilters({ limit: 10, symbol: 'AAPL', category: 'portfolio_intelligence', portfolioScore: 50, riskTier: 'balanced' })).toMatchObject({ limit: 10, symbol: 'AAPL' })
    expect(() => validatePortfolioHistoryFilters({ limit: 200 })).toThrow('portfolio history limit is invalid')
    expect(() => validatePortfolioHistoryFilters({ symbol: 'BAD SYMBOL' })).toThrow('portfolio symbol is invalid')
    expect(() => validatePortfolioHistoryFilters({ riskTier: 'certain_profit' })).toThrow('portfolio risk tier is invalid')
  })

  it('persists compact snapshots without raw prompts or provider payloads', async () => {
    const repository = createPortfolioIntelligenceRepository({ database: { connected: false } })
    const snapshot = await repository.createSnapshot({ ...evaluatePortfolioHealth(portfolio()), tenantContext, accountId: 'paper-portfolio', userId: tenantContext.userId })
    expect(snapshot.snapshot.payload.rawProviderPayloadStored).toBe(false)
    expect(snapshot.snapshot.payload.chainOfThoughtStored).toBe(false)
    expect(JSON.stringify(snapshot)).not.toMatch(/raw prompt|authorization|Bearer/i)
  })

  it('enforces authenticated tenant/account/user scope for evaluate and history actions', async () => {
    const repository = {
      createSnapshot: vi.fn(async (input) => ({ ok: true, snapshot: input })),
      listSnapshots: vi.fn(async () => [{ id: 'snap-1', portfolioScore: 70, riskTier: 'balanced', payload: { rawProviderPayloadStored: false } }]),
    }
    const handler = createAtlasPortfolioIntelligenceHandler({
      portfolioIntelligenceRepository: repository,
      atlasAiGateway: { run: vi.fn(async () => ({ atlasAiRequest: { status: 'completed' }, atlasAiResponse: { summary: 'Portfolio reviewed.', observations: [], risks: [], recommendations: [], limitations: [] }, providerHealth: { status: 'healthy' } })) },
      organizationMembershipRepository: membership('analyst'),
      accountId: 'paper-portfolio',
    })
    const evaluated = parse(await handler(authEvent({ action: 'evaluate', ...portfolio({ accountId: 'client-supplied' }) })))
    expect(evaluated.statusCode).toBe(200)
    expect(repository.createSnapshot).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'paper-portfolio', userId: tenantContext.userId }))
    expect(evaluated.json.data.liveOrders).toBe(false)
    const history = parse(await handler(authEvent({ action: 'history', filters: { limit: 5, symbol: 'AAPL' } })))
    expect(history.statusCode).toBe(200)
    expect(history.json.data.pagination.limit).toBe(5)
    expect(repository.listSnapshots).toHaveBeenCalledWith(expect.objectContaining({ tenantContext: expect.objectContaining({ organizationId: 'org-atlas-local' }), accountId: 'paper-portfolio', userId: tenantContext.userId }))
    const viewer = createAtlasPortfolioIntelligenceHandler({ portfolioIntelligenceRepository: repository, organizationMembershipRepository: membership('viewer'), accountId: 'paper-portfolio' })
    expect(parse(await viewer(authEvent({ action: 'history', filters: { limit: 5 } }, 'viewer'))).statusCode).toBe(403)
    const crossTenant = createAtlasPortfolioIntelligenceHandler({ portfolioIntelligenceRepository: repository, organizationMembershipRepository: membership('analyst', 'org-other'), accountId: 'paper-portfolio' })
    expect(parse(await crossTenant(authEvent({ action: 'history', filters: { limit: 5 } }))).statusCode).toBe(403)
  })
})

describe('Phase 88D UI and release regressions', () => {
  it('renders portfolio intelligence, loading/error/degraded/empty copy, accessible controls, and no trade controls', () => {
    const props = {
      portfolioSummary: { account: { accountValue: 100000, cash: 50000 }, positions: [] },
      riskMetrics: { positions: [position({ asOf: '2026-07-18T10:00:00.000Z', missingData: ['quote'] })] },
      watchlist: [],
      signals: [],
      opportunities: [],
      MetricCard,
      formatNumber: (value) => String(value),
    }
    const markup = renderToStaticMarkup(React.createElement(AtlasPortfolioIntelligencePanel, props))
    const loading = renderToStaticMarkup(React.createElement(AtlasPortfolioIntelligencePanel, { ...props, initialViewState: 'loading' }))
    const failed = renderToStaticMarkup(React.createElement(AtlasPortfolioIntelligencePanel, { ...props, initialViewState: 'failed' }))
    expect(markup).toContain('Portfolio Intelligence')
    expect(markup).toContain('Health Score')
    expect(markup).toContain('AI Insight Card')
    expect(loading).toContain('Loading portfolio intelligence')
    expect(failed).toContain('Portfolio intelligence could not be refreshed')
    expect(markup).toContain('degraded')
    expect(markup).toContain('aria-label="Portfolio intelligence view controls"')
    expect(markup).not.toMatch(/buy now|execute trade|broker action/i)
    expect(markup).not.toContain('Submit order')
  })

  it('registers API reliability, migration safety, and no execution path', () => {
    const route = API_ROUTE_REGISTRY.find((entry) => entry.id === 'atlas-portfolio-intelligence')
    expect(route).toMatchObject({ path: '/.netlify/functions/atlas-portfolio-intelligence', authenticated: true })
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_portfolio_intelligence_snapshots')
    expect(sql).toContain('idx_atlas_ai_portfolio_intelligence_tenant')
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i)
    const health = evaluatePortfolioHealth(portfolio())
    expect(health.liveOrders).toBe(false)
    expect(health.brokerExecution).toBe(false)
    expect(health.advisoryOnly).toBe(true)
    expect(health.paperTrading).toBe(true)
  })
})
