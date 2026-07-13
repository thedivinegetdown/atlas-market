import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_LEARNING_SUMMARY_CAPTURED_EVENT = 'system.complianceStrategicLearningSummary.captured'
export const STRATEGIC_LEARNING_STATUSES = Object.freeze(['captured', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_LEARNING_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicLearningSummary(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-learning-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    learningStatus: safeStatus(input.learningStatus ?? input.status),
    learningScore: Math.max(0, Math.min(100, Number(input.learningScore ?? 0))),
    learningSummaryText: String(input.learningSummaryText ?? input.learningSummary ?? 'Compliance strategic learning summary captured for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticLearningClaim: false,
    automaticPolicyUpdate: false,
    automaticStrategyChange: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicLearningSummaryRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const learning = normalizeComplianceStrategicLearningSummary(input)
      if (!database?.connected) return { ok: true, disabled: true, learning }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_learning_summaries
          (id, organization_id, team_workspace_id, learning_status, learning_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET learning_status = EXCLUDED.learning_status, learning_score = EXCLUDED.learning_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [learning.id, learning.tenantScope.organizationId, learning.tenantScope.teamWorkspaceId, learning.learningStatus, learning.learningScore, learning],
      )
      return { ok: true, learning: normalizeComplianceStrategicLearningSummary(result.rows?.[0]?.payload ?? learning) }
    },
    async list({ tenantContext = {}, learningStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (learningStatus) {
        params.push(safeStatus(learningStatus))
        clauses.push(`learning_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_learning_summaries
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicLearningSummary(row.payload))
    },
  }
}

export function captureComplianceStrategicLearningSummary(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicLearningSummaries ?? input.complianceStrategicLearningSummary ?? []
  const outcome = input.complianceStrategicOutcomeReview ?? {}
  const adaptation = input.complianceStrategicAdaptationReadiness ?? {}
  const feedback = input.complianceStrategicFeedbackIntake ?? {}
  const outcomeScore = outcome.strategicOutcomeSummary?.averageOutcomeScore ?? 0
  const adaptationScore = adaptation.strategicAdaptationSummary?.averageAdaptationScore ?? outcomeScore
  const feedbackScore = feedback.strategicFeedbackSummary?.averageFeedbackScore ?? outcomeScore
  const score = Math.max(0, Math.min(100, Math.round((outcomeScore + adaptationScore + feedbackScore) / 3)))
  const learningStatus = score >= 85 ? 'captured' : score >= 60 ? 'needs-review' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const learningSummaries = (sourceItems.length ? sourceItems : [normalizeComplianceStrategicLearningSummary({
    tenantContext,
    learningStatus,
    learningScore: score,
    learningSummaryText: `Compliance strategic learning summary references outcome score ${outcomeScore}, adaptation score ${adaptationScore}, and feedback score ${feedbackScore}.`,
    sourceReferences: [
      { id: 'compliance-strategic-outcome-review', type: 'compliance-strategic-outcome-review', eventType: outcome.eventType },
      { id: 'compliance-strategic-adaptation-readiness', type: 'compliance-strategic-adaptation-readiness', eventType: adaptation.eventType },
      { id: 'compliance-strategic-feedback-intake', type: 'compliance-strategic-feedback-intake', eventType: feedback.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicLearningSummary)
  const strategicLearningSummary = {
    total: learningSummaries.length,
    captured: learningSummaries.filter((item) => item.learningStatus === 'captured').length,
    needsReview: learningSummaries.filter((item) => item.learningStatus === 'needs-review').length,
    blocked: learningSummaries.filter((item) => item.learningStatus === 'blocked').length,
    averageLearningScore: learningSummaries.length ? Math.round(learningSummaries.reduce((sum, item) => sum + item.learningScore, 0) / learningSummaries.length) : 0,
  }
  const strategicLearningStatus = strategicLearningSummary.blocked > 0 ? 'blocked' : strategicLearningSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_LEARNING_SUMMARY_CAPTURED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicLearningSummaries: learningSummaries,
    strategicLearningSummary,
    strategicLearningStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticLearningClaim: false,
    automaticPolicyUpdate: false,
    automaticStrategyChange: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic learning summary ${strategicLearningStatus}: average learning score ${strategicLearningSummary.averageLearningScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_LEARNING_SUMMARY_CAPTURED_EVENT, result)
  return result
}
