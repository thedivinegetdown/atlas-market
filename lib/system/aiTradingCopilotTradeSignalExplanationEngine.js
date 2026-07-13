import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_TRADING_COPILOT_TRADE_SIGNAL_EXPLAINED_EVENT = 'system.aiTradingCopilotTradeSignal.explained'
export const AI_TRADING_COPILOT_TRADE_SIGNAL_EXPLANATION_STATUSES = Object.freeze(['ready', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return AI_TRADING_COPILOT_TRADE_SIGNAL_EXPLANATION_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeReason(reason = {}) {
  return {
    id: String(reason.id ?? 'reason'),
    label: String(reason.label ?? 'Reason').slice(0, 120),
    value: String(reason.value ?? 'review').slice(0, 160),
    weight: clampScore(reason.weight),
  }
}

export function normalizeAiTradingCopilotTradeSignalExplanationRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-trading-copilot-trade-signal-explanation-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    explanationStatus: safeStatus(input.explanationStatus ?? input.status),
    explanationScore: clampScore(input.explanationScore),
    signalDirection: String(input.signalDirection ?? 'neutral').slice(0, 40),
    paperTradeAction: String(input.paperTradeAction ?? 'review').slice(0, 80),
    confidenceReasoningSummary: String(input.confidenceReasoningSummary ?? 'Confidence reasoning prepared from existing paper-trading decision and signal context.').slice(0, 700),
    tradeExplanationSummary: String(input.tradeExplanationSummary ?? input.explanationSummary ?? 'Trade and signal explanation prepared for human review.').slice(0, 700),
    reasoningFactors: (input.reasoningFactors ?? []).slice(0, 8).map(normalizeReason),
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

export function createAiTradingCopilotTradeSignalExplanationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const explanation = normalizeAiTradingCopilotTradeSignalExplanationRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, explanation }
      const result = await database.query(
        `INSERT INTO atlas_ai_trading_copilot_trade_signal_explanations
          (id, organization_id, team_workspace_id, explanation_status, explanation_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET explanation_status = EXCLUDED.explanation_status, explanation_score = EXCLUDED.explanation_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [explanation.id, explanation.tenantScope.organizationId, explanation.tenantScope.teamWorkspaceId, explanation.explanationStatus, explanation.explanationScore, explanation],
      )
      return { ok: true, explanation: normalizeAiTradingCopilotTradeSignalExplanationRecord(result.rows?.[0]?.payload ?? explanation) }
    },
    async list({ tenantContext = {}, explanationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (explanationStatus) {
        params.push(safeStatus(explanationStatus))
        clauses.push(`explanation_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_ai_trading_copilot_trade_signal_explanations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiTradingCopilotTradeSignalExplanationRecord(row.payload))
    },
  }
}

export function explainAiTradingCopilotTradeSignal(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiTradingCopilotTradeSignalExplanations ?? input.aiTradingCopilotTradeSignalExplanation ?? []
  const aiDecision = input.aiDecision ?? {}
  const strategySignal = input.strategySignalComposition ?? input.strategySignal ?? {}
  const copilotContext = input.aiTradingCopilotContext ?? {}
  const copilotResponse = input.aiTradingCopilotResponse ?? {}
  const guardrail = input.tradeGuardrail ?? input.guardrailDecision ?? {}
  const positionSizing = input.positionSizing ?? {}
  const aiConfidence = clampScore(aiDecision.confidenceScore)
  const signalStrength = clampScore(strategySignal.signalStrengthScore ?? strategySignal.normalizedStrategySignal?.signalStrengthScore)
  const signalConfidence = clampScore(strategySignal.confidenceScore ?? aiConfidence)
  const contextScore = clampScore(copilotContext.aiTradingCopilotContextSummary?.averageContextScore ?? aiConfidence)
  const responseScore = clampScore(copilotResponse.aiTradingCopilotResponseSummary?.averageResponseScore ?? contextScore)
  const guardrailScore = guardrail.decision === 'rejected' || guardrail.approved === false ? 35 : 90
  const sizingScore = positionSizing.status === 'blocked' ? 35 : positionSizing.status === 'recommended' ? 90 : 70
  const score = Math.round((aiConfidence + signalStrength + signalConfidence + contextScore + responseScore + guardrailScore + sizingScore) / 7)
  const explanationStatus = score >= 85 ? 'ready' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const explanations = (sourceItems.length ? sourceItems : [normalizeAiTradingCopilotTradeSignalExplanationRecord({
    tenantContext,
    explanationStatus,
    explanationScore: score,
    signalDirection: strategySignal.signalDirection ?? strategySignal.normalizedStrategySignal?.signalDirection ?? 'neutral',
    paperTradeAction: aiDecision.finalDecision ?? strategySignal.normalizedStrategySignal?.signalAction ?? 'review',
    confidenceReasoningSummary: `Confidence uses AI score ${aiConfidence}, signal strength ${signalStrength}, signal confidence ${signalConfidence}, copilot context ${contextScore}, copilot response ${responseScore}, guardrail readiness ${guardrailScore}, and sizing readiness ${sizingScore}.`,
    tradeExplanationSummary: `Paper trade explanation is ${explanationStatus}; ${strategySignal.rationaleSummary ?? aiDecision.rationale ?? 'review the existing signal, AI decision, guardrail, and position sizing context before any manual paper action.'}`,
    reasoningFactors: [
      { id: 'ai-confidence', label: 'AI confidence', value: aiConfidence, weight: aiConfidence },
      { id: 'signal-strength', label: 'Signal strength', value: signalStrength, weight: signalStrength },
      { id: 'signal-confidence', label: 'Signal confidence', value: signalConfidence, weight: signalConfidence },
      { id: 'copilot-context', label: 'Copilot context', value: contextScore, weight: contextScore },
      { id: 'guardrail-readiness', label: 'Guardrail readiness', value: guardrail.decision ?? guardrail.status ?? 'review', weight: guardrailScore },
      { id: 'position-sizing', label: 'Position sizing', value: positionSizing.status ?? 'review', weight: sizingScore },
    ],
    sourceReferences: [
      { id: 'ai-decision', type: 'ai-decision', eventType: aiDecision.eventType },
      { id: 'strategy-signal', type: 'strategy-signal', eventType: strategySignal.eventType },
      { id: 'ai-trading-copilot-context', type: 'ai-trading-copilot-context', eventType: copilotContext.eventType },
      { id: 'ai-trading-copilot-response', type: 'ai-trading-copilot-response', eventType: copilotResponse.eventType },
      { id: 'trade-guardrail', type: 'trade-guardrail', eventType: guardrail.eventType },
      { id: 'position-sizing', type: 'position-sizing', eventType: positionSizing.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeAiTradingCopilotTradeSignalExplanationRecord)
  const aiTradingCopilotTradeSignalExplanationSummary = {
    total: explanations.length,
    ready: explanations.filter((item) => item.explanationStatus === 'ready').length,
    needsReview: explanations.filter((item) => item.explanationStatus === 'needs-review').length,
    blocked: explanations.filter((item) => item.explanationStatus === 'blocked').length,
    averageExplanationScore: explanations.length ? Math.round(explanations.reduce((sum, item) => sum + item.explanationScore, 0) / explanations.length) : 0,
  }
  const aiTradingCopilotTradeSignalExplanationStatus = aiTradingCopilotTradeSignalExplanationSummary.blocked > 0 ? 'blocked' : aiTradingCopilotTradeSignalExplanationSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_TRADING_COPILOT_TRADE_SIGNAL_EXPLAINED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiTradingCopilotTradeSignalExplanations: explanations,
    aiTradingCopilotTradeSignalExplanationSummary,
    aiTradingCopilotTradeSignalExplanationStatus,
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
    summary: `AI trading copilot trade signal explanation ${aiTradingCopilotTradeSignalExplanationStatus}: average explanation score ${aiTradingCopilotTradeSignalExplanationSummary.averageExplanationScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_TRADING_COPILOT_TRADE_SIGNAL_EXPLAINED_EVENT, result)
  return result
}
