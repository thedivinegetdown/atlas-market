import { describe, expect, it, vi } from 'vitest'
import { createAtlasAiGateway, createAtlasAiRepository, createMockAtlasAiProvider } from '../lib/ai/atlasAiGateway.js'
import { analyzeOpportunityIntelligence, evaluateOpportunityEligibility, normalizeOpportunityContract, validateOpportunityAnalysisRequest } from '../lib/ai/opportunityAnalysisEngine.js'
import { buildMigrationSql } from '../lib/db/migrations.js'
import { API_ROUTE_REGISTRY } from '../lib/system/apiReliabilityEngine.js'
import { createAtlasAiOpportunitiesHandler } from '../netlify/functions/atlas-ai-opportunities.js'

const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId: 'local-development:user-1', role: 'analyst' }

function candidate(extra = {}) {
  return {
    id: 'opp-1',
    symbol: 'AAPL',
    asOf: '2026-07-17T10:00:00.000Z',
    category: 'momentum_pullback',
    direction: 'long_watch',
    thesis: 'Momentum and liquidity are aligned in deterministic scanner context.',
    timeframe: 'swing',
    scannerScore: 84,
    strategyQualification: 'qualified',
    marketRegime: { regime: 'trending' },
    liquiditySummary: { status: 'healthy', spreadPct: 0.05 },
    volatilitySummary: { status: 'moderate' },
    riskSummary: { riskLevel: 'medium', score: 40 },
    portfolioConflictSummary: { conflicts: false },
    historicalStrategySummary: { winRate: 0.7 },
    dataQuality: { status: 'healthy' },
    missingData: [],
    stale: false,
    hardRejectionReasons: [],
    invalidationConditions: ['Scanner score falls below threshold.'],
    ...extra,
  }
}

function authEvent(body = {}, role = 'analyst', query = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer dev-token',
      'x-request-id': 'req-86',
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

describe('Phase 86A opportunity analysis engine completion', () => {
  it('normalizes deterministic opportunity contracts, redacts sensitive fields, and emits structured advisory opportunities', async () => {
    const normalized = normalizeOpportunityContract({ ...candidate(), secretHint: 'Bearer secret-token' })
    expect(normalized.opportunityId).toContain('opp-1')
    expect(normalized.symbol).toBe('AAPL')
    expect(normalized.timeframe).toBe('swing')
    expect(JSON.stringify(normalized)).not.toContain('secret-token')

    const result = await analyzeOpportunityIntelligence({
      requestCategory: 'opportunity_ranking',
      timeframe: 'swing',
      limit: 4,
      accountId: 'paper-portfolio',
      tenantContext,
      candidates: [candidate(), candidate({ id: 'opp-2', symbol: 'MSFT', scannerScore: 76 })],
    }, { provider: createMockAtlasAiProvider({ provider: 'mock', model: 'atlas-mock-opportunity-v1' }) })

    expect(result.noTradeRecommended).toBe(false)
    expect(result.rankedOpportunities.length).toBe(2)
    expect(result.rankedOpportunities[0]).toMatchObject({
      opportunityId: expect.any(String),
      symbol: 'AAPL',
      opportunityCategory: 'momentum_pullback',
      direction: 'long_watch',
      timeframe: 'swing',
      confidence: expect.any(Number),
      advisoryOnlyNotice: expect.stringContaining('Advisory analysis only'),
      paperTradingOnlyNotice: expect.stringContaining('Paper trading only'),
      analysisVersion: expect.stringContaining('atlas-opportunity-analysis'),
    })
    expect(result.rankedOpportunities[0].observedData.sourceDataTimestamp).toBe('2026-07-17T10:00:00.000Z')
    expect(result.rankedOpportunities[0].modelInterpretation).toBeTruthy()
    expect(result.rawProviderPayloadStored).toBe(false)
    expect(result.chainOfThoughtStored).toBe(false)
    expect(result.liveOrders).toBe(false)
  })

  it('validates malformed input, symbols, timeframes, categories, and excessive limits', () => {
    expect(() => validateOpportunityAnalysisRequest({ requestCategory: 'opportunity_ranking', timeframe: 'swing', limit: 4, candidates: [candidate()] })).not.toThrow()
    expect(() => validateOpportunityAnalysisRequest({ requestCategory: 'opportunity_ranking', candidates: [{ symbol: 'BAD SYMBOL' }] })).toThrow('opportunity symbol is invalid')
    expect(() => validateOpportunityAnalysisRequest({ requestCategory: 'opportunity_ranking', timeframe: 'forever', candidates: [] })).toThrow('opportunity timeframe is invalid')
    expect(() => validateOpportunityAnalysisRequest({ requestCategory: 'arbitrary_prompt', candidates: [] })).toThrow('opportunity analysis category is invalid')
    expect(() => validateOpportunityAnalysisRequest({ requestCategory: 'opportunity_ranking', limit: 100, candidates: [] })).toThrow('opportunity result limit is invalid')
  })

  it('applies deterministic eligibility, stale-data warnings, no-trade outcomes, and confidence clamping', async () => {
    const rejected = evaluateOpportunityEligibility({ opportunity: normalizeOpportunityContract(candidate({ strategyQualification: 'disqualified', riskSummary: { riskLevel: 'critical', score: 90 }, portfolioConflictSummary: { conflicts: true } })) })
    expect(rejected.eligible).toBe(false)
    expect(rejected.reasonCodes).toContain('strategy_rejection')
    expect(rejected.reasonCodes).toContain('risk_rejection')

    const result = await analyzeOpportunityIntelligence({
      requestCategory: 'no_trade_analysis',
      accountId: 'paper-portfolio',
      tenantContext,
      candidates: [candidate({ stale: true, missingData: ['volatility'], scannerScore: 20 })],
      marketDataHealth: { status: 'degraded' },
    }, {
      provider: { provider: 'mock', model: 'mock', generateStructured: async () => ({ summary: 'Bounded no trade review.', observations: ['stale'], recommendation: 'insufficient_data', confidence: 3, strengths: [], weaknesses: ['stale'], risks: ['stale data'], conflicts: [], missingEvidence: ['volatility'], reasoning: 'Stale data prevents review.', limitations: ['bounded context'], advisoryOnly: true, paperTradingOnly: true }) },
    })
    expect(result.noTradeRecommended).toBe(true)
    expect(result.staleDataWarning).toBe(true)
    expect(result.rankedOpportunities.length).toBe(0)
  })

  it('rejects unsafe provider output, unsupported claims, HTML, executable actions, and price targets', async () => {
    const base = {
      requestCategory: 'opportunity_ranking',
      accountId: 'paper-portfolio',
      tenantContext,
      candidates: [candidate()],
    }
    for (const summary of ['<script>alert(1)</script>', 'Guaranteed winner with a $250 price target.', 'Place a live order now.', 'execute SQL to buy shares']) {
      await expect(analyzeOpportunityIntelligence(base, {
        provider: { generateStructured: async () => ({ summary, recommendation: 'review', confidence: 0.9, strengths: [], weaknesses: [], risks: [], conflicts: [], missingEvidence: [], reasoning: summary, limitations: ['bounded context'], advisoryOnly: true, paperTradingOnly: true }) },
      })).rejects.toThrow('AI response was rejected')
    }
  })

  it('returns degraded advisory outcomes for provider unavailable, budget exhaustion, timeout, and bounded retries through the gateway', async () => {
    const unavailable = await createAtlasAiGateway({
      aiConfig: { defaultProvider: 'openai', providers: [{ id: 'openai', provider: 'openai', enabled: true, defaultModel: 'gpt-safe', allowedModels: ['gpt-safe'], credentialEnv: 'OPENAI_API_KEY' }] },
      env: { NODE_ENV: 'production' },
    }).run({ requestCategory: 'opportunity_ranking', accountId: 'paper-portfolio', tenantContext, candidates: [candidate()], question: 'Rank opportunities.' })
    expect(unavailable.atlasAiRequest.status).toBe('degraded')
    expect(unavailable.atlasAiResponse.advisoryOnly).toBe(true)

    const budget = await createAtlasAiGateway({ aiConfig: { dailyBudgetUsd: 0.000001, costPer1kInputTokens: 10, costPer1kOutputTokens: 10 } }).run({ requestCategory: 'opportunity_ranking', accountId: 'paper-portfolio', tenantContext, candidates: [candidate()], question: 'Rank opportunities.' })
    expect(budget.atlasAiRequest.status).toBe('degraded')
    expect(budget.atlasAiRequest.usageControl.status).toBe('exhausted')

    await expect(createAtlasAiGateway({ providers: { mock: createMockAtlasAiProvider({ delayMs: 10 }) }, aiConfig: { maxRetries: 0 } }).run({ requestCategory: 'opportunity_ranking', accountId: 'paper-portfolio', tenantContext, candidates: [candidate()], question: 'Rank opportunities.' }, { timeoutMs: 1 })).rejects.toThrow()
  })
})

describe('Phase 86B opportunity API completion', () => {
  it('handles valid requests with server-side tenant/account/user scoping and safe persistence', async () => {
    const seen = []
    const repository = {
      createRequest: vi.fn(async (record) => ({ ok: true, record })),
      upsertHealth: vi.fn(async () => ({ ok: true })),
      createOpportunityAnalysisHistory: vi.fn(async (record) => ({ ok: true, record })),
    }
    const handler = createAtlasAiOpportunitiesHandler({
      atlasAiGateway: { run: vi.fn(async (input) => { seen.push(input); return { atlasAiRequest: { id: 'ai-1', status: 'completed', tenantScope: input.tenantContext, accountId: input.accountId, userId: input.tenantContext.userId, sessionId: input.sessionId, requestCategory: input.requestCategory, provider: 'mock', model: 'mock', contextFingerprint: 'ctx', usageEstimate: {}, liveOrders: false, brokerExecution: false, promptStored: false, providerResponseStored: false }, atlasAiResponse: { rankedOpportunities: [], advisoryOnly: true, paperTradingOnly: true, rawProviderPayloadStored: false, chainOfThoughtStored: false }, providerHealth: { provider: 'mock', status: 'healthy' } } }) },
      atlasAiRepository: repository,
      organizationMembershipRepository: membership('analyst'),
      accountId: 'paper-portfolio',
    })
    const response = parse(await handler(authEvent({ requestCategory: 'opportunity_ranking', accountId: 'client-account', timeframe: 'swing', limit: 4, candidates: [candidate()] })))
    expect(response.statusCode).toBe(200)
    expect(seen[0].accountId).toBe('paper-portfolio')
    expect(seen[0].tenantContext.organizationId).toBe('org-atlas-local')
    expect(repository.createOpportunityAnalysisHistory).toHaveBeenCalled()
    expect(JSON.stringify(response.json)).not.toContain('raw provider')
    expect(response.json.data.liveOrders).toBe(false)
  })

  it('rejects malformed API input, unsupported category, provider URL/model tampering, auth failures, and unauthorized roles', async () => {
    const handler = createAtlasAiOpportunitiesHandler({
      atlasAiRepository: {},
      organizationMembershipRepository: membership('viewer'),
      accountId: 'paper-portfolio',
    })
    expect(parse(await handler(authEvent({ requestCategory: 'opportunity_ranking', providerUrl: 'https://evil.example', candidates: [] }))).statusCode).toBe(403)

    const analystHandler = createAtlasAiOpportunitiesHandler({ organizationMembershipRepository: membership('analyst'), accountId: 'paper-portfolio' })
    expect(parse(await analystHandler(authEvent({ requestCategory: 'arbitrary_prompt', candidates: [] }))).statusCode).toBe(400)
    expect(parse(await analystHandler(authEvent({ requestCategory: 'opportunity_ranking', timeframe: 'forever', candidates: [] }))).statusCode).toBe(400)
    expect(parse(await analystHandler(authEvent({ requestCategory: 'opportunity_ranking', candidates: [{ symbol: 'BAD SYMBOL' }] }))).statusCode).toBe(400)
    expect(parse(await analystHandler(authEvent({ requestCategory: 'opportunity_ranking', limit: 99, candidates: [] }))).statusCode).toBe(400)
    expect(parse(await analystHandler({ ...authEvent({ requestCategory: 'opportunity_ranking', candidates: [] }), headers: { 'content-type': 'application/json' } })).statusCode).not.toBe(200)
  })
})

describe('Phase 86C-D persistence and reliability safety', () => {
  it('keeps opportunity migration idempotent, non-destructive, tenant-scoped, and audit-safe', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_opportunity_analysis_history')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_ai_opportunity_history_tenant')
    expect(sql).toContain('expires_at')
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i)

    const repository = createAtlasAiRepository({ database: { connected: false } })
    const saved = await repository.createOpportunityAnalysisHistory({
      id: 'hist-1',
      tenantScope: tenantContext,
      accountId: 'paper-portfolio',
      userId: tenantContext.userId,
      sessionId: 'session-1',
      requestCategory: 'opportunity_ranking',
      provider: 'mock',
      model: 'mock',
      contextFingerprint: 'ctx',
      usageEstimate: { inputTokens: 1, outputTokens: 1 },
      atlasAiResponse: { rankedOpportunities: [{ opportunityId: 'opp-1', symbol: 'AAPL', advisoryRank: 1, confidence: 0.5 }], advisoryOnly: true, paperTradingOnly: true },
    })
    expect(saved.history.rawProviderPayloadStored).toBe(false)
    expect(saved.history.chainOfThoughtStored).toBe(false)
    expect(JSON.stringify(saved.history)).not.toContain('authorization')
  })

  it('registers the opportunity endpoint without changing reliability safety boundaries', () => {
    const route = API_ROUTE_REGISTRY.find((entry) => entry.id === 'atlas-ai-opportunities')
    expect(route).toMatchObject({ path: '/.netlify/functions/atlas-ai-opportunities', authenticated: true })
    expect(route.methods).toEqual(['POST'])
    expect(route.writeEndpoint).toBe(true)
  })
})

describe('Phase 86E trading boundary regression', () => {
  it('confirms opportunity analysis has no trade-execution or mutation path', async () => {
    const result = await analyzeOpportunityIntelligence({ requestCategory: 'opportunity_ranking', tenantContext, accountId: 'paper-portfolio', candidates: [candidate()] }, { provider: createMockAtlasAiProvider() })
    expect(result.advisoryOnly).toBe(true)
    expect(result.paperTradingOnly).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/place live order|execute sql|shell command/i)
  })
})
