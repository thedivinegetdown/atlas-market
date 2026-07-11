import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_MEETING_MINUTES_RECORDED_EVENT = 'system.complianceMeetingMinutes.recorded'

export const MEETING_MINUTES_STATUSES = Object.freeze(['draft', 'ready_for_review', 'recorded', 'needs_updates'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return MEETING_MINUTES_STATUSES.includes(status) ? status : 'draft'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceMeetingMinutes(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-meeting-minutes-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    minutesStatus: safeStatus(input.minutesStatus ?? input.status),
    meetingType: input.meetingType ?? 'compliance-governance-review',
    meetingSummary: String(input.meetingSummary ?? 'Compliance governance meeting minutes prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    discussionTopics: (input.discussionTopics ?? []).map((item) => String(item).slice(0, 220)),
    decisionReferences: (input.decisionReferences ?? []).map(normalizeReference),
    recordedByUserId: input.recordedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceMeetingMinutesRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(minutesInput) {
      const minutes = normalizeComplianceMeetingMinutes(minutesInput)
      if (!database?.connected) return { ok: true, disabled: true, minutes }
      const result = await database.query(
        `INSERT INTO atlas_compliance_meeting_minutes
          (id, organization_id, team_workspace_id, minutes_status, meeting_type, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET minutes_status = EXCLUDED.minutes_status, meeting_type = EXCLUDED.meeting_type, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [minutes.id, minutes.tenantScope.organizationId, minutes.tenantScope.teamWorkspaceId, minutes.minutesStatus, minutes.meetingType, minutes],
      )
      return { ok: true, minutes: normalizeComplianceMeetingMinutes(result.rows?.[0]?.payload ?? minutes) }
    },
    async list({ tenantContext = {}, minutesStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (minutesStatus) {
        params.push(safeStatus(minutesStatus))
        clauses.push(`minutes_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_meeting_minutes
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceMeetingMinutes(row.payload))
    },
  }
}

export function recordComplianceMeetingMinutes(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceMeetingMinutes ?? []
  const boardPacket = input.complianceBoardPacket ?? {}
  const decisionLog = input.complianceGovernanceDecisionLog ?? {}
  const examReadiness = input.complianceExamReadiness ?? {}
  const needsUpdates = boardPacket.boardPacketStatus === 'caution' || examReadiness.examReadinessStatus === 'blocked'
  const minutes = (supplied.length ? supplied : [normalizeComplianceMeetingMinutes({
    tenantContext,
    minutesStatus: needsUpdates ? 'needs_updates' : 'ready_for_review',
    meetingSummary: `Compliance meeting minutes reference ${boardPacket.boardPacketSummary?.readyForReview ?? 0} board packets ready for review and ${decisionLog.decisionSummary?.total ?? 0} governance decisions.`,
    sourceReferences: [
      { id: 'compliance-board-packet', type: 'compliance-board-packet', eventType: boardPacket.eventType },
      { id: 'compliance-governance-decision', type: 'compliance-governance-decision-log', eventType: decisionLog.eventType },
      { id: 'compliance-exam-readiness', type: 'compliance-exam-readiness', eventType: examReadiness.eventType },
    ],
    discussionTopics: ['Compliance board packet review', 'Exam readiness posture', 'Governance decision follow-up'],
    decisionReferences: decisionLog.complianceGovernanceDecisions?.map((decision) => ({ id: decision.id, type: 'compliance-governance-decision', eventType: decisionLog.eventType })) ?? [],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceMeetingMinutes)
  const meetingMinutesSummary = {
    total: minutes.length,
    readyForReview: minutes.filter((item) => item.minutesStatus === 'ready_for_review').length,
    recorded: minutes.filter((item) => item.minutesStatus === 'recorded').length,
    needsUpdates: minutes.filter((item) => item.minutesStatus === 'needs_updates').length,
  }
  const meetingMinutesStatus = meetingMinutesSummary.needsUpdates > 0 ? 'caution' : meetingMinutesSummary.readyForReview > 0 || meetingMinutesSummary.recorded > 0 ? 'ready' : 'caution'
  const result = {
    eventType: SYSTEM_COMPLIANCE_MEETING_MINUTES_RECORDED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceMeetingMinutes: minutes,
    meetingMinutesSummary,
    meetingMinutesStatus,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticDistribution: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance meeting minutes ${meetingMinutesStatus}: ${meetingMinutesSummary.readyForReview} ready for review and ${meetingMinutesSummary.recorded} recorded.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_MEETING_MINUTES_RECORDED_EVENT, result)
  return result
}
