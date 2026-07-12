import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_LESSONS_LEARNED_CAPTURED_EVENT = 'system.complianceLessonsLearned.captured'
export const LESSON_STATUSES = Object.freeze(['captured', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return LESSON_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceLessonsLearned(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-lessons-learned-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    lessonStatus: safeStatus(input.lessonStatus ?? input.status),
    lessonScore: Math.max(0, Math.min(100, Number(input.lessonScore ?? 0))),
    lessonSummaryText: String(input.lessonSummaryText ?? input.lessonSummary ?? 'Compliance lessons learned captured for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticPolicyUpdate: false,
    automaticTrainingAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceLessonsLearnedRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const lesson = normalizeComplianceLessonsLearned(input)
      if (!database?.connected) return { ok: true, disabled: true, lesson }
      const result = await database.query(
        `INSERT INTO atlas_compliance_lessons_learned
          (id, organization_id, team_workspace_id, lesson_status, lesson_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET lesson_status = EXCLUDED.lesson_status, lesson_score = EXCLUDED.lesson_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [lesson.id, lesson.tenantScope.organizationId, lesson.tenantScope.teamWorkspaceId, lesson.lessonStatus, lesson.lessonScore, lesson],
      )
      return { ok: true, lesson: normalizeComplianceLessonsLearned(result.rows?.[0]?.payload ?? lesson) }
    },
    async list({ tenantContext = {}, lessonStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (lessonStatus) {
        params.push(safeStatus(lessonStatus))
        clauses.push(`lesson_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_lessons_learned
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceLessonsLearned(row.payload))
    },
  }
}

export function captureComplianceLessonsLearned(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceLessonsLearned ?? []
  const review = input.compliancePostImplementationReview ?? {}
  const program = input.complianceProgramHealth ?? {}
  const reviewScore = review.reviewSummary?.averageReviewScore ?? 0
  const programScore = program.programHealthSummary?.averageScore ?? reviewScore
  const score = Math.round((reviewScore + programScore) / 2)
  const lessonStatus = score >= 85 ? 'captured' : score >= 60 ? 'needs-review' : 'blocked'
  const lessons = (supplied.length ? supplied : [normalizeComplianceLessonsLearned({
    tenantContext,
    lessonStatus,
    lessonScore: score,
    lessonSummaryText: `Compliance lessons learned capture references post-implementation review score ${reviewScore} and program health score ${programScore}.`,
    sourceReferences: [
      { id: 'compliance-post-implementation-review', type: 'compliance-post-implementation-review', eventType: review.eventType },
      { id: 'compliance-program-health', type: 'compliance-program-health', eventType: program.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceLessonsLearned)
  const lessonSummary = {
    total: lessons.length,
    captured: lessons.filter((item) => item.lessonStatus === 'captured').length,
    needsReview: lessons.filter((item) => item.lessonStatus === 'needs-review').length,
    blocked: lessons.filter((item) => item.lessonStatus === 'blocked').length,
    averageLessonScore: lessons.length ? Math.round(lessons.reduce((sum, item) => sum + item.lessonScore, 0) / lessons.length) : 0,
  }
  const lessonsLearnedStatus = lessonSummary.blocked > 0 ? 'blocked' : lessonSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_LESSONS_LEARNED_CAPTURED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceLessonsLearned: lessons,
    lessonSummary,
    lessonsLearnedStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticPolicyUpdate: false,
    automaticTrainingAssignment: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance lessons learned ${lessonsLearnedStatus}: average lesson score ${lessonSummary.averageLessonScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_LESSONS_LEARNED_CAPTURED_EVENT, result)
  return result
}
