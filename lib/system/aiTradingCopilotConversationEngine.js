import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_TRADING_COPILOT_CONVERSATION_PREPARED_EVENT = 'system.aiTradingCopilotConversation.prepared'
export const AI_TRADING_COPILOT_CONVERSATION_STATUSES = Object.freeze(['ready', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return AI_TRADING_COPILOT_CONVERSATION_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeTurn(turn = {}) {
  return {
    id: String(turn.id ?? 'turn'),
    role: ['operator', 'copilot'].includes(turn.role) ? turn.role : 'copilot',
    content: String(turn.content ?? 'Review portfolio and research context before manual paper-trading action.').slice(0, 700),
    sourceReferences: (turn.sourceReferences ?? []).slice(0, 6).map(normalizeReference),
  }
}

export function normalizeAiTradingCopilotConversationRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-trading-copilot-conversation-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    conversationStatus: safeStatus(input.conversationStatus ?? input.status),
    conversationScore: clampScore(input.conversationScore),
    operatorQuestion: String(input.operatorQuestion ?? 'Summarize the current portfolio and research context.').slice(0, 400),
    portfolioAnalysisSummary: String(input.portfolioAnalysisSummary ?? 'Portfolio analysis prepared from existing Atlas outputs.').slice(0, 700),
    researchSummary: String(input.researchSummary ?? 'Research summary prepared from existing market intelligence and copilot insights.').slice(0, 700),
    conversationTurns: (input.conversationTurns ?? []).slice(0, 6).map(normalizeTurn),
    followUpQuestions: (input.followUpQuestions ?? []).slice(0, 5).map((question) => String(question).slice(0, 180)),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    externalAiProvider: false,
    automaticOrderPlacement: false,
    automaticBrokerExecution: false,
    automaticDecisionOverride: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createAiTradingCopilotConversationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const conversation = normalizeAiTradingCopilotConversationRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, conversation }
      const result = await database.query(
        `INSERT INTO atlas_ai_trading_copilot_conversations
          (id, organization_id, team_workspace_id, conversation_status, conversation_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET conversation_status = EXCLUDED.conversation_status, conversation_score = EXCLUDED.conversation_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [conversation.id, conversation.tenantScope.organizationId, conversation.tenantScope.teamWorkspaceId, conversation.conversationStatus, conversation.conversationScore, conversation],
      )
      return { ok: true, conversation: normalizeAiTradingCopilotConversationRecord(result.rows?.[0]?.payload ?? conversation) }
    },
    async list({ tenantContext = {}, conversationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (conversationStatus) {
        params.push(safeStatus(conversationStatus))
        clauses.push(`conversation_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_ai_trading_copilot_conversations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiTradingCopilotConversationRecord(row.payload))
    },
  }
}

export function prepareAiTradingCopilotConversation(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiTradingCopilotConversations ?? input.aiTradingCopilotConversation ?? []
  const portfolioInsight = input.aiTradingCopilotPortfolioInsight ?? {}
  const tradeSignalExplanation = input.aiTradingCopilotTradeSignalExplanation ?? {}
  const marketIntelligence = input.marketIntelligence ?? {}
  const researchEnhancedDecision = input.researchEnhancedDecision ?? {}
  const portfolioAnalytics = input.portfolioAnalytics ?? {}
  const risk = input.portfolioRisk ?? input.risk ?? {}
  const insightScore = clampScore(portfolioInsight.aiTradingCopilotPortfolioInsightSummary?.averageInsightScore)
  const explanationScore = clampScore(tradeSignalExplanation.aiTradingCopilotTradeSignalExplanationSummary?.averageExplanationScore ?? insightScore)
  const researchScore = clampScore(researchEnhancedDecision.researchInfluenceScore ?? marketIntelligence.confidenceScore ?? insightScore)
  const diversificationScore = clampScore(portfolioAnalytics.diversification?.score ?? 75)
  const riskReadinessScore = clampScore(100 - Number(risk.summary?.riskScore ?? 25))
  const score = Math.round((insightScore + explanationScore + researchScore + diversificationScore + riskReadinessScore) / 5)
  const conversationStatus = score >= 85 ? 'ready' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const conversations = (sourceItems.length ? sourceItems : [normalizeAiTradingCopilotConversationRecord({
    tenantContext,
    conversationStatus,
    conversationScore: score,
    operatorQuestion: input.operatorQuestion,
    portfolioAnalysisSummary: `Portfolio analysis uses copilot insight ${insightScore}, explanation ${explanationScore}, diversification ${diversificationScore}, and risk readiness ${riskReadinessScore}.`,
    researchSummary: `Research summary uses research influence ${researchScore} and market intelligence ${marketIntelligence.eventType ?? 'not supplied'} without external AI provider calls.`,
    conversationTurns: [
      { id: 'operator-question', role: 'operator', content: input.operatorQuestion ?? 'What matters most in the current paper-trading portfolio context?' },
      { id: 'copilot-portfolio-answer', role: 'copilot', content: `Current portfolio context is ${conversationStatus}; review risk readiness, diversification, research influence, and trade-signal explanation before any manual paper action.` },
    ],
    followUpQuestions: [
      'Which portfolio exposure has the largest impact on this paper-trading setup?',
      'What research input most changes the current confidence?',
      'What risk condition should be reviewed before the next manual paper action?',
      'Which strategy comparison detail needs operator attention?',
    ],
    sourceReferences: [
      { id: 'copilot-portfolio-insight', type: 'copilot-portfolio-insight', eventType: portfolioInsight.eventType },
      { id: 'trade-signal-explanation', type: 'trade-signal-explanation', eventType: tradeSignalExplanation.eventType },
      { id: 'market-intelligence', type: 'market-intelligence', eventType: marketIntelligence.eventType },
      { id: 'research-enhanced-decision', type: 'research-enhanced-decision', eventType: researchEnhancedDecision.eventType },
      { id: 'portfolio-analytics', type: 'portfolio-analytics', eventType: portfolioAnalytics.eventType },
      { id: 'portfolio-risk', type: 'portfolio-risk', eventType: risk.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeAiTradingCopilotConversationRecord)
  const aiTradingCopilotConversationSummary = {
    total: conversations.length,
    ready: conversations.filter((item) => item.conversationStatus === 'ready').length,
    needsReview: conversations.filter((item) => item.conversationStatus === 'needs-review').length,
    blocked: conversations.filter((item) => item.conversationStatus === 'blocked').length,
    averageConversationScore: conversations.length ? Math.round(conversations.reduce((sum, item) => sum + item.conversationScore, 0) / conversations.length) : 0,
  }
  const aiTradingCopilotConversationStatus = aiTradingCopilotConversationSummary.blocked > 0 ? 'blocked' : aiTradingCopilotConversationSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_TRADING_COPILOT_CONVERSATION_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiTradingCopilotConversations: conversations,
    aiTradingCopilotConversationSummary,
    aiTradingCopilotConversationStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    externalAiProvider: false,
    automaticOrderPlacement: false,
    automaticBrokerExecution: false,
    automaticDecisionOverride: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `AI trading copilot conversation ${aiTradingCopilotConversationStatus}: average conversation score ${aiTradingCopilotConversationSummary.averageConversationScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_TRADING_COPILOT_CONVERSATION_PREPARED_EVENT, result)
  return result
}
