import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_DECISION_EXPLAINABILITY_PREPARED_EVENT = 'system.aiDecisionExplainability.prepared'
export const AI_DECISION_EXPLAINABILITY_STATUSES = Object.freeze(['complete', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return AI_DECISION_EXPLAINABILITY_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeAiDecisionExplainabilityRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-decision-explainability-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    explainabilityStatus: safeStatus(input.explainabilityStatus ?? input.status),
    explainabilityScore: Math.max(0, Math.min(100, Number(input.explainabilityScore ?? 0))),
    explanationSummaryText: String(input.explanationSummaryText ?? input.explanationSummary ?? 'AI decision explainability prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticExplanationClaim: false,
    automaticModelApproval: false,
    automaticDecisionOverride: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createAiDecisionExplainabilityRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const explanation = normalizeAiDecisionExplainabilityRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, explanation }
      const result = await database.query(
        `INSERT INTO atlas_ai_decision_explainability_records
          (id, organization_id, team_workspace_id, explainability_status, explainability_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET explainability_status = EXCLUDED.explainability_status, explainability_score = EXCLUDED.explainability_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [explanation.id, explanation.tenantScope.organizationId, explanation.tenantScope.teamWorkspaceId, explanation.explainabilityStatus, explanation.explainabilityScore, explanation],
      )
      return { ok: true, explanation: normalizeAiDecisionExplainabilityRecord(result.rows?.[0]?.payload ?? explanation) }
    },
    async list({ tenantContext = {}, explainabilityStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (explainabilityStatus) {
        params.push(safeStatus(explainabilityStatus))
        clauses.push(`explainability_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_ai_decision_explainability_records
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiDecisionExplainabilityRecord(row.payload))
    },
  }
}

export function prepareAiDecisionExplainability(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiDecisionExplainabilityRecords ?? input.aiDecisionExplainability ?? []
  const governance = input.aiDecisionGovernanceReadiness ?? {}
  const aiDecision = input.aiDecision ?? {}
  const researchEnhancedDecision = input.researchEnhancedDecision ?? {}
  const knowledgeBase = input.complianceStrategicKnowledgeBase ?? {}
  const governanceScore = governance.aiDecisionGovernanceSummary?.averageGovernanceScore ?? 0
  const aiConfidenceScore = Math.max(0, Math.min(100, Number(aiDecision.confidenceScore ?? governanceScore)))
  const researchInfluenceScore = Math.max(0, Math.min(100, Number(researchEnhancedDecision.researchInfluenceScore ?? governanceScore)))
  const knowledgeScore = knowledgeBase.strategicKnowledgeSummary?.averageKnowledgeScore ?? governanceScore
  const rationalePenalty = aiDecision.rationale || researchEnhancedDecision.decisionAdjustmentRationale ? 0 : 20
  const score = Math.max(0, Math.min(100, Math.round(((governanceScore + aiConfidenceScore + researchInfluenceScore + knowledgeScore) / 4) - rationalePenalty)))
  const explainabilityStatus = score >= 85 ? 'complete' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const explainabilityRecords = (sourceItems.length ? sourceItems : [normalizeAiDecisionExplainabilityRecord({
    tenantContext,
    explainabilityStatus,
    explainabilityScore: score,
    explanationSummaryText: `AI decision explainability references governance score ${governanceScore}, AI confidence ${aiConfidenceScore}, research influence ${researchInfluenceScore}, knowledge score ${knowledgeScore}, and rationale penalty ${rationalePenalty}.`,
    sourceReferences: [
      { id: 'ai-decision-governance-readiness', type: 'ai-decision-governance-readiness', eventType: governance.eventType },
      { id: 'ai-decision', type: 'ai-decision', eventType: aiDecision.eventType },
      { id: 'research-enhanced-decision', type: 'research-enhanced-decision', eventType: researchEnhancedDecision.eventType },
      { id: 'compliance-strategic-knowledge-base', type: 'compliance-strategic-knowledge-base', eventType: knowledgeBase.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeAiDecisionExplainabilityRecord)
  const aiDecisionExplainabilitySummary = {
    total: explainabilityRecords.length,
    complete: explainabilityRecords.filter((item) => item.explainabilityStatus === 'complete').length,
    needsReview: explainabilityRecords.filter((item) => item.explainabilityStatus === 'needs-review').length,
    blocked: explainabilityRecords.filter((item) => item.explainabilityStatus === 'blocked').length,
    averageExplainabilityScore: explainabilityRecords.length ? Math.round(explainabilityRecords.reduce((sum, item) => sum + item.explainabilityScore, 0) / explainabilityRecords.length) : 0,
  }
  const aiDecisionExplainabilityStatus = aiDecisionExplainabilitySummary.blocked > 0 ? 'blocked' : aiDecisionExplainabilitySummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_DECISION_EXPLAINABILITY_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiDecisionExplainabilityRecords: explainabilityRecords,
    aiDecisionExplainabilitySummary,
    aiDecisionExplainabilityStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticExplanationClaim: false,
    automaticModelApproval: false,
    automaticDecisionOverride: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `AI decision explainability ${aiDecisionExplainabilityStatus}: average explainability score ${aiDecisionExplainabilitySummary.averageExplainabilityScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_DECISION_EXPLAINABILITY_PREPARED_EVENT, result)
  return result
}
