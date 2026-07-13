import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { prepareAiTradingCopilotContext } from '../lib/system/aiTradingCopilotContextEngine.js'
import { prepareAiTradingCopilotResponse } from '../lib/system/aiTradingCopilotResponseEngine.js'
import { createAiTradingCopilotTradeSignalExplanationRepository, explainAiTradingCopilotTradeSignal, SYSTEM_AI_TRADING_COPILOT_TRADE_SIGNAL_EXPLAINED_EVENT } from '../lib/system/aiTradingCopilotTradeSignalExplanationEngine.js'
import { createAiTradingCopilotPortfolioInsightRepository, generateAiTradingCopilotPortfolioInsights, SYSTEM_AI_TRADING_COPILOT_PORTFOLIO_INSIGHTS_GENERATED_EVENT } from '../lib/system/aiTradingCopilotPortfolioInsightEngine.js'
import { createAiTradingCopilotTradeSignalExplanationsHandler } from '../netlify/functions/ai-trading-copilot-trade-signal-explanations.js'
import { createAiTradingCopilotPortfolioInsightsHandler } from '../netlify/functions/ai-trading-copilot-portfolio-insights.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'analyst') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase61ab',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'analyst') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function upstream() {
  const aiDecision = { eventType: 'ai.decision.orchestrated', finalDecision: 'approve', confidenceScore: 91, rationale: 'Paper decision is approved for review.' }
  const strategySignalComposition = {
    eventType: 'strategy.signal.composed',
    signalDirection: 'bullish',
    signalStrengthScore: 87,
    confidenceScore: 86,
    rationaleSummary: 'Strategy signal is bullish and eligible for paper review.',
    normalizedStrategySignal: { signalDirection: 'bullish', signalAction: 'paper-buy' },
  }
  const aiTradingCopilotContext = prepareAiTradingCopilotContext({
    tenantContext,
    aiDecision,
    researchEnhancedDecision: { eventType: 'ai.decision.researchEnhanced', researchInfluenceScore: 90 },
    marketIntelligence: { eventType: 'research.marketIntelligence.evaluated', confidenceScore: 88 },
    risk: { eventType: 'portfolio.risk.updated', summary: { riskScore: 18 } },
    portfolioAnalytics: { eventType: 'portfolio.analytics.updated', diversification: { score: 82 } },
    aiDecisionExplainability: { eventType: 'system.aiDecisionExplainability.prepared', aiDecisionExplainabilitySummary: { averageExplainabilityScore: 89 } },
  }, { emitEvent: false })
  const aiTradingCopilotResponse = prepareAiTradingCopilotResponse({
    tenantContext,
    aiTradingCopilotContext,
    aiDecisionGovernanceReadiness: { eventType: 'system.aiDecisionGovernanceReadiness.evaluated', aiDecisionGovernanceSummary: { averageGovernanceScore: 90 } },
    operatorActionCenter: { eventType: 'system.operatorActions.generated', platformActionSummary: { openActions: 0 } },
  }, { emitEvent: false })
  const aiTradingCopilotTradeSignalExplanation = explainAiTradingCopilotTradeSignal({
    tenantContext,
    aiDecision,
    strategySignalComposition,
    aiTradingCopilotContext,
    aiTradingCopilotResponse,
    tradeGuardrail: { eventType: 'trade.guardrail.evaluated', decision: 'approved', approved: true },
    positionSizing: { eventType: 'position.sizing.recommended', status: 'recommended' },
  }, { emitEvent: false })
  return {
    aiDecision,
    strategySignalComposition,
    aiTradingCopilotContext,
    aiTradingCopilotResponse,
    aiTradingCopilotTradeSignalExplanation,
    tradeGuardrail: { eventType: 'trade.guardrail.evaluated', decision: 'approved', approved: true },
    positionSizing: { eventType: 'position.sizing.recommended', status: 'recommended' },
    strategyAttribution: { eventType: 'strategy.attribution.evaluated' },
    strategyBacktestPerformance: { eventType: 'strategy.backtestPerformance.evaluated', performanceSummary: { profitFactor: 1.8 } },
    portfolioAnalytics: { eventType: 'portfolio.analytics.updated', diversification: { score: 83 } },
    portfolioOptimization: { eventType: 'portfolio.optimization.recommended', optimizationConfidenceScore: 84 },
    portfolioRisk: { eventType: 'portfolio.risk.updated', summary: { riskScore: 19 } },
  }
}

describe('Phase 61A AI trading copilot trade and signal explanations', () => {
  it('adds idempotent migration and parameterized trade signal explanation access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_trading_copilot_trade_signal_explanations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_trading_copilot_portfolio_insights')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiTradingCopilotTradeSignalExplanationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'copilot-explanation-1', tenantContext, explanationStatus: 'ready', explanationScore: 92 })
    await repository.list({ tenantContext, explanationStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('explains trade and signal confidence without execution or decision override', () => {
    const result = upstream().aiTradingCopilotTradeSignalExplanation
    expect(result.eventType).toBe(SYSTEM_AI_TRADING_COPILOT_TRADE_SIGNAL_EXPLAINED_EVENT)
    expect(result.externalAiProvider).toBe(false)
    expect(result.automaticOrderPlacement).toBe(false)
    expect(result.automaticDecisionOverride).toBe(false)
    expect(result.automaticBrokerExecution).toBe(false)
    expect(result.aiTradingCopilotTradeSignalExplanations[0].reasoningFactors.length).toBeGreaterThan(3)
  })

  it('serves trade signal explanation APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiTradingCopilotTradeSignalExplanationsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createAiTradingCopilotTradeSignalExplanationsHandler(options)(authEvent('POST', { explanation: { id: 'copilot-explanation-1' } })))
    const denied = parseResponse(await createAiTradingCopilotTradeSignalExplanationsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiTradingCopilotTradeSignalExplanation.externalAiProvider).toBe(false)
    expect(create.json.data.explanation.automaticOrderPlacement).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 61B AI trading copilot strategy and portfolio insights', () => {
  it('generates portfolio insights and natural-language research prompts without external AI', async () => {
    const source = upstream()
    const result = generateAiTradingCopilotPortfolioInsights(source, { emitEvent: false })
    expect(result.eventType).toBe(SYSTEM_AI_TRADING_COPILOT_PORTFOLIO_INSIGHTS_GENERATED_EVENT)
    expect(result.externalAiProvider).toBe(false)
    expect(result.automaticOrderPlacement).toBe(false)
    expect(result.automaticBrokerExecution).toBe(false)
    expect(result.aiTradingCopilotPortfolioInsights[0].naturalLanguageResearchPrompts.length).toBeGreaterThan(2)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiTradingCopilotPortfolioInsightRepository({ database: { connected: true, query } })
    await repository.create({ id: 'copilot-insight-1', tenantContext, insightStatus: 'ready', insightScore: 92 })
    await repository.list({ tenantContext, insightStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves portfolio insight APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiTradingCopilotPortfolioInsightsHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createAiTradingCopilotPortfolioInsightsHandler(options)(authEvent('POST', { insight: { id: 'copilot-insight-1' } }, 'admin')))
    const denied = parseResponse(await createAiTradingCopilotPortfolioInsightsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiTradingCopilotPortfolioInsight.externalAiProvider).toBe(false)
    expect(create.json.data.insight.automaticDecisionOverride).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public portfolio insight responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createAiTradingCopilotPortfolioInsightsHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
