import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { explainAiTradingCopilotTradeSignal } from '../lib/system/aiTradingCopilotTradeSignalExplanationEngine.js'
import { generateAiTradingCopilotPortfolioInsights } from '../lib/system/aiTradingCopilotPortfolioInsightEngine.js'
import { createAiTradingCopilotConversationRepository, prepareAiTradingCopilotConversation, SYSTEM_AI_TRADING_COPILOT_CONVERSATION_PREPARED_EVENT } from '../lib/system/aiTradingCopilotConversationEngine.js'
import { createAiTradingCopilotWorkflowAssistanceRepository, prepareAiTradingCopilotWorkflowAssistance, SYSTEM_AI_TRADING_COPILOT_WORKFLOW_ASSISTANCE_PREPARED_EVENT } from '../lib/system/aiTradingCopilotWorkflowAssistanceEngine.js'
import { createAiTradingCopilotConversationsHandler } from '../netlify/functions/ai-trading-copilot-conversations.js'
import { createAiTradingCopilotWorkflowAssistanceHandler } from '../netlify/functions/ai-trading-copilot-workflow-assistance.js'

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
      'x-request-id': 'req-phase62ab',
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
  const aiTradingCopilotTradeSignalExplanation = explainAiTradingCopilotTradeSignal({
    tenantContext,
    aiDecision: { eventType: 'ai.decision.orchestrated', finalDecision: 'approve', confidenceScore: 91 },
    strategySignalComposition: { eventType: 'strategy.signal.composed', signalDirection: 'bullish', signalStrengthScore: 88, confidenceScore: 87 },
    aiTradingCopilotContext: { eventType: 'system.aiTradingCopilotContext.prepared', aiTradingCopilotContextSummary: { averageContextScore: 90 } },
    aiTradingCopilotResponse: { eventType: 'system.aiTradingCopilotResponse.prepared', aiTradingCopilotResponseSummary: { averageResponseScore: 89 } },
    tradeGuardrail: { eventType: 'trade.guardrail.evaluated', decision: 'approved', approved: true },
    positionSizing: { eventType: 'position.sizing.recommended', status: 'recommended' },
  }, { emitEvent: false })
  const aiTradingCopilotPortfolioInsight = generateAiTradingCopilotPortfolioInsights({
    tenantContext,
    strategySignalComposition: { eventType: 'strategy.signal.composed', signalDirection: 'bullish', signalStrengthScore: 88, confidenceScore: 87 },
    strategyAttribution: { eventType: 'strategy.attribution.evaluated' },
    strategyBacktestPerformance: { eventType: 'strategy.backtestPerformance.evaluated', performanceSummary: { profitFactor: 1.9 } },
    portfolioAnalytics: { eventType: 'portfolio.analytics.updated', diversification: { score: 84 } },
    portfolioOptimization: { eventType: 'portfolio.optimization.recommended', optimizationConfidenceScore: 86 },
    portfolioRisk: { eventType: 'portfolio.risk.updated', summary: { riskScore: 17 } },
    aiTradingCopilotTradeSignalExplanation,
  }, { emitEvent: false })
  const aiTradingCopilotConversation = prepareAiTradingCopilotConversation({
    tenantContext,
    operatorQuestion: 'What matters most in this portfolio?',
    aiTradingCopilotPortfolioInsight,
    aiTradingCopilotTradeSignalExplanation,
    marketIntelligence: { eventType: 'research.marketIntelligence.evaluated', confidenceScore: 89 },
    researchEnhancedDecision: { eventType: 'ai.decision.researchEnhanced', researchInfluenceScore: 90 },
    portfolioAnalytics: { eventType: 'portfolio.analytics.updated', diversification: { score: 84 } },
    portfolioRisk: { eventType: 'portfolio.risk.updated', summary: { riskScore: 17 } },
  }, { emitEvent: false })
  const operatorActionCenter = { eventType: 'system.operatorActions.generated', platformActionSummary: { openActions: 0 } }
  const workspaceCommandPalette = { eventType: 'workspace.commandPalette.executed', commandExecutionResult: { status: 'executed' } }
  const aiTradingCopilotWorkflowAssistance = prepareAiTradingCopilotWorkflowAssistance({
    tenantContext,
    aiTradingCopilotConversation,
    aiTradingCopilotPortfolioInsight,
    aiTradingCopilotTradeSignalExplanation,
    operatorActionCenter,
    workspaceCommandPalette,
  }, { emitEvent: false })
  return {
    aiTradingCopilotTradeSignalExplanation,
    aiTradingCopilotPortfolioInsight,
    aiTradingCopilotConversation,
    aiTradingCopilotWorkflowAssistance,
    marketIntelligence: { eventType: 'research.marketIntelligence.evaluated', confidenceScore: 89 },
    researchEnhancedDecision: { eventType: 'ai.decision.researchEnhanced', researchInfluenceScore: 90 },
    portfolioAnalytics: { eventType: 'portfolio.analytics.updated', diversification: { score: 84 } },
    portfolioRisk: { eventType: 'portfolio.risk.updated', summary: { riskScore: 17 } },
    operatorActionCenter,
    workspaceCommandPalette,
  }
}

describe('Phase 62A AI trading copilot conversational portfolio analysis', () => {
  it('adds idempotent conversation migration and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_trading_copilot_conversations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_trading_copilot_workflow_assistance')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiTradingCopilotConversationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'copilot-conversation-1', tenantContext, conversationStatus: 'ready', conversationScore: 92 })
    await repository.list({ tenantContext, conversationStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares conversational portfolio analysis and research summaries without external AI', () => {
    const result = upstream().aiTradingCopilotConversation
    expect(result.eventType).toBe(SYSTEM_AI_TRADING_COPILOT_CONVERSATION_PREPARED_EVENT)
    expect(result.externalAiProvider).toBe(false)
    expect(result.automaticOrderPlacement).toBe(false)
    expect(result.aiTradingCopilotConversations[0].conversationTurns.length).toBeGreaterThan(1)
    expect(result.aiTradingCopilotConversations[0].followUpQuestions.length).toBeGreaterThan(2)
  })

  it('serves conversation APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiTradingCopilotConversationsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createAiTradingCopilotConversationsHandler(options)(authEvent('POST', { conversation: { id: 'copilot-conversation-1' } })))
    const denied = parseResponse(await createAiTradingCopilotConversationsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiTradingCopilotConversation.externalAiProvider).toBe(false)
    expect(create.json.data.conversation.automaticOrderPlacement).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 62B AI trading copilot workflow assistance', () => {
  it('prepares workflow assistance with safe human-reviewed steps only', async () => {
    const result = upstream().aiTradingCopilotWorkflowAssistance
    expect(result.eventType).toBe(SYSTEM_AI_TRADING_COPILOT_WORKFLOW_ASSISTANCE_PREPARED_EVENT)
    expect(result.externalAiProvider).toBe(false)
    expect(result.automaticOrderPlacement).toBe(false)
    expect(result.automaticDecisionOverride).toBe(false)
    expect(result.automaticBrokerExecution).toBe(false)
    expect(result.aiTradingCopilotWorkflowAssistanceRecords[0].workflowSteps.length).toBeGreaterThan(2)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiTradingCopilotWorkflowAssistanceRepository({ database: { connected: true, query } })
    await repository.create({ id: 'copilot-workflow-1', tenantContext, workflowStatus: 'ready', workflowScore: 92 })
    await repository.list({ tenantContext, workflowStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves workflow assistance APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiTradingCopilotWorkflowAssistanceHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createAiTradingCopilotWorkflowAssistanceHandler(options)(authEvent('POST', { workflow: { id: 'copilot-workflow-1' } }, 'admin')))
    const denied = parseResponse(await createAiTradingCopilotWorkflowAssistanceHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiTradingCopilotWorkflowAssistance.externalAiProvider).toBe(false)
    expect(create.json.data.workflow.automaticDecisionOverride).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public workflow responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createAiTradingCopilotWorkflowAssistanceHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
