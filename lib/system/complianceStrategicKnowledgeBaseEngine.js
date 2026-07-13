import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_KNOWLEDGE_BASE_UPDATED_EVENT = 'system.complianceStrategicKnowledgeBase.updated'
export const STRATEGIC_KNOWLEDGE_STATUSES = Object.freeze(['current', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_KNOWLEDGE_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicKnowledgeBaseEntry(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-knowledge-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    knowledgeStatus: safeStatus(input.knowledgeStatus ?? input.status),
    knowledgeScore: Math.max(0, Math.min(100, Number(input.knowledgeScore ?? 0))),
    knowledgeSummaryText: String(input.knowledgeSummaryText ?? input.knowledgeSummary ?? 'Compliance strategic knowledge base updated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticKnowledgeClaim: false,
    automaticPolicyUpdate: false,
    automaticStrategyChange: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicKnowledgeBaseRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const knowledge = normalizeComplianceStrategicKnowledgeBaseEntry(input)
      if (!database?.connected) return { ok: true, disabled: true, knowledge }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_knowledge_base
          (id, organization_id, team_workspace_id, knowledge_status, knowledge_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET knowledge_status = EXCLUDED.knowledge_status, knowledge_score = EXCLUDED.knowledge_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [knowledge.id, knowledge.tenantScope.organizationId, knowledge.tenantScope.teamWorkspaceId, knowledge.knowledgeStatus, knowledge.knowledgeScore, knowledge],
      )
      return { ok: true, knowledge: normalizeComplianceStrategicKnowledgeBaseEntry(result.rows?.[0]?.payload ?? knowledge) }
    },
    async list({ tenantContext = {}, knowledgeStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (knowledgeStatus) {
        params.push(safeStatus(knowledgeStatus))
        clauses.push(`knowledge_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_knowledge_base
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicKnowledgeBaseEntry(row.payload))
    },
  }
}

export function updateComplianceStrategicKnowledgeBase(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicKnowledgeBase ?? input.complianceStrategicKnowledgeBaseEntries ?? []
  const learning = input.complianceStrategicLearningSummary ?? {}
  const outcome = input.complianceStrategicOutcomeReview ?? {}
  const lessons = input.complianceLessonsLearned ?? {}
  const learningScore = learning.strategicLearningSummary?.averageLearningScore ?? 0
  const outcomeScore = outcome.strategicOutcomeSummary?.averageOutcomeScore ?? learningScore
  const lessonScore = lessons.lessonsLearnedSummary?.averageLessonScore ?? lessons.lessonsLearnedSummary?.averageLearningScore ?? learningScore
  const score = Math.max(0, Math.min(100, Math.round((learningScore + outcomeScore + lessonScore) / 3)))
  const knowledgeStatus = score >= 85 ? 'current' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const knowledgeEntries = (sourceItems.length ? sourceItems : [normalizeComplianceStrategicKnowledgeBaseEntry({
    tenantContext,
    knowledgeStatus,
    knowledgeScore: score,
    knowledgeSummaryText: `Compliance strategic knowledge base references learning score ${learningScore}, outcome score ${outcomeScore}, and lessons score ${lessonScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-learning-summary', type: 'compliance-strategic-learning-summary', eventType: learning.eventType },
      { id: 'compliance-strategic-outcome-review', type: 'compliance-strategic-outcome-review', eventType: outcome.eventType },
      { id: 'compliance-lessons-learned', type: 'compliance-lessons-learned', eventType: lessons.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicKnowledgeBaseEntry)
  const strategicKnowledgeSummary = {
    total: knowledgeEntries.length,
    current: knowledgeEntries.filter((item) => item.knowledgeStatus === 'current').length,
    needsReview: knowledgeEntries.filter((item) => item.knowledgeStatus === 'needs-review').length,
    blocked: knowledgeEntries.filter((item) => item.knowledgeStatus === 'blocked').length,
    averageKnowledgeScore: knowledgeEntries.length ? Math.round(knowledgeEntries.reduce((sum, item) => sum + item.knowledgeScore, 0) / knowledgeEntries.length) : 0,
  }
  const strategicKnowledgeStatus = strategicKnowledgeSummary.blocked > 0 ? 'blocked' : strategicKnowledgeSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_KNOWLEDGE_BASE_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicKnowledgeBase: knowledgeEntries,
    strategicKnowledgeSummary,
    strategicKnowledgeStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticKnowledgeClaim: false,
    automaticPolicyUpdate: false,
    automaticStrategyChange: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic knowledge base ${strategicKnowledgeStatus}: average knowledge score ${strategicKnowledgeSummary.averageKnowledgeScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_KNOWLEDGE_BASE_UPDATED_EVENT, result)
  return result
}
