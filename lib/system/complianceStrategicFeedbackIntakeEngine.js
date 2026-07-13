import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_STRATEGIC_FEEDBACK_INTAKE_EVALUATED_EVENT = 'system.complianceStrategicFeedbackIntake.evaluated'
export const STRATEGIC_FEEDBACK_STATUSES = Object.freeze(['constructive', 'needs-review', 'escalated'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return STRATEGIC_FEEDBACK_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceStrategicFeedbackIntake(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-strategic-feedback-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    feedbackStatus: safeStatus(input.feedbackStatus ?? input.status),
    feedbackScore: Math.max(0, Math.min(100, Number(input.feedbackScore ?? 0))),
    feedbackSummaryText: String(input.feedbackSummaryText ?? input.feedbackSummary ?? 'Compliance strategic feedback intake evaluated for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticFeedbackCollection: false,
    automaticEscalation: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceStrategicFeedbackIntakeRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const feedback = normalizeComplianceStrategicFeedbackIntake(input)
      if (!database?.connected) return { ok: true, disabled: true, feedback }
      const result = await database.query(
        `INSERT INTO atlas_compliance_strategic_feedback_intake
          (id, organization_id, team_workspace_id, feedback_status, feedback_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET feedback_status = EXCLUDED.feedback_status, feedback_score = EXCLUDED.feedback_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [feedback.id, feedback.tenantScope.organizationId, feedback.tenantScope.teamWorkspaceId, feedback.feedbackStatus, feedback.feedbackScore, feedback],
      )
      return { ok: true, feedback: normalizeComplianceStrategicFeedbackIntake(result.rows?.[0]?.payload ?? feedback) }
    },
    async list({ tenantContext = {}, feedbackStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (feedbackStatus) {
        params.push(safeStatus(feedbackStatus))
        clauses.push(`feedback_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_strategic_feedback_intake
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceStrategicFeedbackIntake(row.payload))
    },
  }
}

export function evaluateComplianceStrategicFeedbackIntake(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceStrategicFeedbackIntake ?? []
  const communication = input.complianceStrategicCommunicationPlan ?? {}
  const alignment = input.complianceStrategicStakeholderAlignment ?? {}
  const operatorActions = input.operatorActionCenter ?? {}
  const communicationScore = communication.strategicCommunicationSummary?.averageCommunicationScore ?? 0
  const alignmentScore = alignment.stakeholderAlignmentSummary?.averageAlignmentScore ?? communicationScore
  const actionPenalty = Math.min(25, Number(operatorActions.platformActionSummary?.openActions ?? 0))
  const score = Math.max(0, Math.min(100, Math.round(((communicationScore + alignmentScore) / 2) - actionPenalty)))
  const feedbackStatus = score >= 85 ? 'constructive' : score >= 60 ? 'needs-review' : 'escalated'
  const feedbackItems = (supplied.length ? supplied : [normalizeComplianceStrategicFeedbackIntake({
    tenantContext,
    feedbackStatus,
    feedbackScore: score,
    feedbackSummaryText: `Compliance strategic feedback intake references communication score ${communicationScore}, alignment score ${alignmentScore}, and operator action penalty ${actionPenalty}.`,
    sourceReferences: [
      { id: 'compliance-strategic-communication-plan', type: 'compliance-strategic-communication-plan', eventType: communication.eventType },
      { id: 'compliance-strategic-stakeholder-alignment', type: 'compliance-strategic-stakeholder-alignment', eventType: alignment.eventType },
      { id: 'operator-action-center', type: 'operator-action-center', eventType: operatorActions.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceStrategicFeedbackIntake)
  const strategicFeedbackSummary = {
    total: feedbackItems.length,
    constructive: feedbackItems.filter((item) => item.feedbackStatus === 'constructive').length,
    needsReview: feedbackItems.filter((item) => item.feedbackStatus === 'needs-review').length,
    escalated: feedbackItems.filter((item) => item.feedbackStatus === 'escalated').length,
    averageFeedbackScore: feedbackItems.length ? Math.round(feedbackItems.reduce((sum, item) => sum + item.feedbackScore, 0) / feedbackItems.length) : 0,
  }
  const strategicFeedbackStatus = strategicFeedbackSummary.escalated > 0 ? 'blocked' : strategicFeedbackSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_STRATEGIC_FEEDBACK_INTAKE_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceStrategicFeedbackIntake: feedbackItems,
    strategicFeedbackSummary,
    strategicFeedbackStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticFeedbackCollection: false,
    automaticEscalation: false,
    automaticAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance strategic feedback intake ${strategicFeedbackStatus}: average feedback score ${strategicFeedbackSummary.averageFeedbackScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_STRATEGIC_FEEDBACK_INTAKE_EVALUATED_EVENT, result)
  return result
}
