import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createAiTradingCopilotContextRepository, prepareAiTradingCopilotContext, SYSTEM_AI_TRADING_COPILOT_CONTEXT_PREPARED_EVENT } from '../lib/system/aiTradingCopilotContextEngine.js'
import { createAiTradingCopilotResponseRepository, prepareAiTradingCopilotResponse, SYSTEM_AI_TRADING_COPILOT_RESPONSE_PREPARED_EVENT } from '../lib/system/aiTradingCopilotResponseEngine.js'
import { createAiTradingCopilotContextsHandler } from '../netlify/functions/ai-trading-copilot-contexts.js'
import { createAiTradingCopilotResponsesHandler } from '../netlify/functions/ai-trading-copilot-responses.js'

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
      'x-request-id': 'req-phase60ab',
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
  const aiDecision = {
    eventType: 'ai.decision.orchestrated',
    finalDecision: 'approve',
    confidenceScore: 91,
    blockers: [],
    rationale: 'AI decision is approved for paper review.',
  }
  const researchEnhancedDecision = {
    eventType: 'ai.decision.researchEnhanced',
    researchInfluenceScore: 90,
    finalResearchAwareDecisionSummary: { finalDecision: 'approve' },
    blockers: [],
  }
  const marketIntelligence = { eventType: 'research.marketIntelligence.evaluated', confidenceScore: 88 }
  const risk = { eventType: 'portfolio.risk.updated', summary: { riskScore: 18 } }
  const portfolioAnalytics = { eventType: 'portfolio.analytics.updated', diversification: { score: 82 } }
  const aiDecisionExplainability = { eventType: 'system.aiDecisionExplainability.prepared', aiDecisionExplainabilitySummary: { averageExplainabilityScore: 89 } }
  const aiDecisionGovernanceReadiness = { eventType: 'system.aiDecisionGovernanceReadiness.evaluated', aiDecisionGovernanceSummary: { averageGovernanceScore: 90 } }
  const operatorActionCenter = { eventType: 'system.operatorActions.generated', platformActionSummary: { openActions: 0 } }
  const aiTradingCopilotContext = prepareAiTradingCopilotContext({
    tenantContext,
    aiDecision,
    researchEnhancedDecision,
    marketIntelligence,
    risk,
    portfolioAnalytics,
    aiDecisionExplainability,
  }, { emitEvent: false })
  const aiTradingCopilotResponse = prepareAiTradingCopilotResponse({
    tenantContext,
    aiTradingCopilotContext,
    aiDecisionGovernanceReadiness,
    operatorActionCenter,
  }, { emitEvent: false })
  return {
    aiDecision,
    researchEnhancedDecision,
    marketIntelligence,
    risk,
    portfolioAnalytics,
    aiDecisionExplainability,
    aiDecisionGovernanceReadiness,
    operatorActionCenter,
    aiTradingCopilotContext,
    aiTradingCopilotResponse,
  }
}

describe('Phase 60A AI trading copilot context', () => {
  it('adds idempotent copilot migrations and parameterized context access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_trading_copilot_contexts')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_trading_copilot_responses')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiTradingCopilotContextRepository({ database: { connected: true, query } })
    await repository.create({ id: 'copilot-context-1', tenantContext, contextStatus: 'ready', contextScore: 92 })
    await repository.list({ tenantContext, contextStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares copilot context without external AI, order placement, or broker execution', () => {
    const source = upstream()
    expect(source.aiTradingCopilotContext.eventType).toBe(SYSTEM_AI_TRADING_COPILOT_CONTEXT_PREPARED_EVENT)
    expect(source.aiTradingCopilotContext.externalAiProvider).toBe(false)
    expect(source.aiTradingCopilotContext.automaticOrderPlacement).toBe(false)
    expect(source.aiTradingCopilotContext.automaticBrokerExecution).toBe(false)
  })

  it('serves copilot context APIs safely for trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiTradingCopilotContextsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createAiTradingCopilotContextsHandler(options)(authEvent('POST', { context: { id: 'copilot-context-1' } })))
    const denied = parseResponse(await createAiTradingCopilotContextsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiTradingCopilotContext.externalAiProvider).toBe(false)
    expect(create.json.data.context.automaticOrderPlacement).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 60B AI trading copilot response', () => {
  it('prepares copilot responses without order placement, decision overrides, or broker execution', async () => {
    const source = upstream()
    expect(source.aiTradingCopilotResponse.eventType).toBe(SYSTEM_AI_TRADING_COPILOT_RESPONSE_PREPARED_EVENT)
    expect(source.aiTradingCopilotResponse.automaticOrderPlacement).toBe(false)
    expect(source.aiTradingCopilotResponse.automaticDecisionOverride).toBe(false)
    expect(source.aiTradingCopilotResponse.automaticBrokerExecution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiTradingCopilotResponseRepository({ database: { connected: true, query } })
    await repository.create({ id: 'copilot-response-1', tenantContext, responseStatus: 'ready', responseScore: 92 })
    await repository.list({ tenantContext, responseStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves copilot response APIs safely for trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiTradingCopilotResponsesHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createAiTradingCopilotResponsesHandler(options)(authEvent('POST', { response: { id: 'copilot-response-1' } }, 'admin')))
    const denied = parseResponse(await createAiTradingCopilotResponsesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiTradingCopilotResponse.automaticOrderPlacement).toBe(false)
    expect(create.json.data.response.automaticDecisionOverride).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createAiTradingCopilotResponsesHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
