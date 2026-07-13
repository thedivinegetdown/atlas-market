import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_TRADING_COPILOT_RESPONSE_PREPARED_EVENT = 'system.aiTradingCopilotResponse.prepared'
export const AI_TRADING_COPILOT_RESPONSE_STATUSES = Object.freeze(['ready', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return AI_TRADING_COPILOT_RESPONSE_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

export function normalizeAiTradingCopilotResponseRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-trading-copilot-response-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    responseStatus: safeStatus(input.responseStatus ?? input.status),
    responseScore: clampScore(input.responseScore),
    responseSummaryText: String(input.responseSummaryText ?? input.responseSummary ?? 'AI trading copilot response prepared for human review.').slice(0, 700),
    suggestedQuestions: (input.suggestedQuestions ?? []).slice(0, 5).map((question) => String(question).slice(0, 180)),
    safeActionReferences: (input.safeActionReferences ?? []).slice(0, 6).map(normalizeReference),
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

export function createAiTradingCopilotResponseRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const response = normalizeAiTradingCopilotResponseRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, response }
      const result = await database.query(
        `INSERT INTO atlas_ai_trading_copilot_responses
          (id, organization_id, team_workspace_id, response_status, response_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET response_status = EXCLUDED.response_status, response_score = EXCLUDED.response_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [response.id, response.tenantScope.organizationId, response.tenantScope.teamWorkspaceId, response.responseStatus, response.responseScore, response],
      )
      return { ok: true, response: normalizeAiTradingCopilotResponseRecord(result.rows?.[0]?.payload ?? response) }
    },
    async list({ tenantContext = {}, responseStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (responseStatus) {
        params.push(safeStatus(responseStatus))
        clauses.push(`response_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_ai_trading_copilot_responses
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiTradingCopilotResponseRecord(row.payload))
    },
  }
}

export function prepareAiTradingCopilotResponse(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiTradingCopilotResponses ?? input.aiTradingCopilotResponse ?? []
  const context = input.aiTradingCopilotContext ?? {}
  const governance = input.aiDecisionGovernanceReadiness ?? {}
  const operatorActions = input.operatorActionCenter ?? {}
  const contextScore = clampScore(context.aiTradingCopilotContextSummary?.averageContextScore)
  const governanceScore = clampScore(governance.aiDecisionGovernanceSummary?.averageGovernanceScore ?? contextScore)
  const openActionPenalty = Math.min(25, Number(operatorActions.platformActionSummary?.openActions ?? 0))
  const score = Math.max(0, Math.min(100, Math.round(((contextScore + governanceScore) / 2) - openActionPenalty)))
  const responseStatus = score >= 85 ? 'ready' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const responses = (sourceItems.length ? sourceItems : [normalizeAiTradingCopilotResponseRecord({
    tenantContext,
    responseStatus,
    responseScore: score,
    responseSummaryText: `AI trading copilot response is ${responseStatus}; review paper decision context, research influence, risk readiness, and open operator actions before taking any manual paper-mode step.`,
    suggestedQuestions: [
      'What changed the AI decision confidence?',
      'Which research or risk inputs need operator review?',
      'Is this paper trade still inside guardrails?',
      'What should be monitored before the next paper action?',
    ],
    safeActionReferences: [
      { id: 'review-paper-decision', type: 'review', eventType: context.eventType },
      { id: 'monitor-risk-context', type: 'monitor', eventType: governance.eventType },
      { id: 'open-operator-actions', type: 'operator-action', eventType: operatorActions.eventType },
    ],
    sourceReferences: [
      { id: 'ai-trading-copilot-context', type: 'ai-trading-copilot-context', eventType: context.eventType },
      { id: 'ai-decision-governance-readiness', type: 'ai-decision-governance-readiness', eventType: governance.eventType },
      { id: 'operator-action-center', type: 'operator-action-center', eventType: operatorActions.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeAiTradingCopilotResponseRecord)
  const aiTradingCopilotResponseSummary = {
    total: responses.length,
    ready: responses.filter((item) => item.responseStatus === 'ready').length,
    needsReview: responses.filter((item) => item.responseStatus === 'needs-review').length,
    blocked: responses.filter((item) => item.responseStatus === 'blocked').length,
    averageResponseScore: responses.length ? Math.round(responses.reduce((sum, item) => sum + item.responseScore, 0) / responses.length) : 0,
  }
  const aiTradingCopilotResponseStatus = aiTradingCopilotResponseSummary.blocked > 0 ? 'blocked' : aiTradingCopilotResponseSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_TRADING_COPILOT_RESPONSE_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiTradingCopilotResponses: responses,
    aiTradingCopilotResponseSummary,
    aiTradingCopilotResponseStatus,
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
    summary: `AI trading copilot response ${aiTradingCopilotResponseStatus}: average response score ${aiTradingCopilotResponseSummary.averageResponseScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_TRADING_COPILOT_RESPONSE_PREPARED_EVENT, result)
  return result
}
