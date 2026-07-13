import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_TRADING_COPILOT_CONTEXT_PREPARED_EVENT = 'system.aiTradingCopilotContext.prepared'
export const AI_TRADING_COPILOT_CONTEXT_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return AI_TRADING_COPILOT_CONTEXT_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

export function normalizeAiTradingCopilotContextRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-trading-copilot-context-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    contextStatus: safeStatus(input.contextStatus ?? input.status),
    contextScore: clampScore(input.contextScore),
    operatorPrompt: String(input.operatorPrompt ?? 'Summarize the current paper-trading decision context.').slice(0, 500),
    contextSummaryText: String(input.contextSummaryText ?? input.contextSummary ?? 'AI trading copilot context prepared for human review.').slice(0, 700),
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

export function createAiTradingCopilotContextRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const context = normalizeAiTradingCopilotContextRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, context }
      const result = await database.query(
        `INSERT INTO atlas_ai_trading_copilot_contexts
          (id, organization_id, team_workspace_id, context_status, context_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET context_status = EXCLUDED.context_status, context_score = EXCLUDED.context_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [context.id, context.tenantScope.organizationId, context.tenantScope.teamWorkspaceId, context.contextStatus, context.contextScore, context],
      )
      return { ok: true, context: normalizeAiTradingCopilotContextRecord(result.rows?.[0]?.payload ?? context) }
    },
    async list({ tenantContext = {}, contextStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (contextStatus) {
        params.push(safeStatus(contextStatus))
        clauses.push(`context_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_ai_trading_copilot_contexts
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiTradingCopilotContextRecord(row.payload))
    },
  }
}

export function prepareAiTradingCopilotContext(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiTradingCopilotContexts ?? input.aiTradingCopilotContext ?? []
  const aiDecision = input.aiDecision ?? {}
  const researchEnhancedDecision = input.researchEnhancedDecision ?? {}
  const marketIntelligence = input.marketIntelligence ?? {}
  const risk = input.portfolioRisk ?? input.risk ?? {}
  const portfolioAnalytics = input.portfolioAnalytics ?? {}
  const explainability = input.aiDecisionExplainability ?? {}
  const aiConfidenceScore = clampScore(aiDecision.confidenceScore)
  const researchInfluenceScore = clampScore(researchEnhancedDecision.researchInfluenceScore ?? aiConfidenceScore)
  const explainabilityScore = clampScore(explainability.aiDecisionExplainabilitySummary?.averageExplainabilityScore ?? aiConfidenceScore)
  const marketConfidenceScore = clampScore(marketIntelligence.confidenceScore ?? researchInfluenceScore)
  const riskReadinessScore = clampScore(100 - Number(risk.summary?.riskScore ?? 25))
  const diversificationScore = clampScore(portfolioAnalytics.diversification?.score ?? 75)
  const score = Math.round((aiConfidenceScore + researchInfluenceScore + explainabilityScore + marketConfidenceScore + riskReadinessScore + diversificationScore) / 6)
  const contextStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const contexts = (sourceItems.length ? sourceItems : [normalizeAiTradingCopilotContextRecord({
    tenantContext,
    contextStatus,
    contextScore: score,
    operatorPrompt: input.operatorPrompt,
    contextSummaryText: `AI trading copilot context references AI confidence ${aiConfidenceScore}, research influence ${researchInfluenceScore}, explainability ${explainabilityScore}, market confidence ${marketConfidenceScore}, risk readiness ${riskReadinessScore}, and diversification ${diversificationScore}.`,
    sourceReferences: [
      { id: 'ai-decision', type: 'ai-decision', eventType: aiDecision.eventType },
      { id: 'research-enhanced-decision', type: 'research-enhanced-decision', eventType: researchEnhancedDecision.eventType },
      { id: 'market-intelligence', type: 'market-intelligence', eventType: marketIntelligence.eventType },
      { id: 'portfolio-risk', type: 'portfolio-risk', eventType: risk.eventType },
      { id: 'ai-decision-explainability', type: 'ai-decision-explainability', eventType: explainability.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeAiTradingCopilotContextRecord)
  const aiTradingCopilotContextSummary = {
    total: contexts.length,
    ready: contexts.filter((item) => item.contextStatus === 'ready').length,
    caution: contexts.filter((item) => item.contextStatus === 'caution').length,
    blocked: contexts.filter((item) => item.contextStatus === 'blocked').length,
    averageContextScore: contexts.length ? Math.round(contexts.reduce((sum, item) => sum + item.contextScore, 0) / contexts.length) : 0,
  }
  const aiTradingCopilotContextStatus = aiTradingCopilotContextSummary.blocked > 0 ? 'blocked' : aiTradingCopilotContextSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_TRADING_COPILOT_CONTEXT_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiTradingCopilotContexts: contexts,
    aiTradingCopilotContextSummary,
    aiTradingCopilotContextStatus,
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
    summary: `AI trading copilot context ${aiTradingCopilotContextStatus}: average context score ${aiTradingCopilotContextSummary.averageContextScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_TRADING_COPILOT_CONTEXT_PREPARED_EVENT, result)
  return result
}
