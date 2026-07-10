import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_EXAM_READINESS_EVALUATED_EVENT = 'system.complianceExamReadiness.evaluated'

export const EXAM_READINESS_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function safeStatus(status) {
  return EXAM_READINESS_STATUSES.includes(status) ? status : 'caution'
}

export function normalizeComplianceExamReadinessEvaluation(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-exam-readiness-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    readinessStatus: safeStatus(input.readinessStatus ?? input.status),
    readinessScore: Math.max(0, Math.min(100, Number(input.readinessScore ?? 0))),
    examScopeSummary: String(input.examScopeSummary ?? 'Compliance exam readiness evaluated for owner/admin review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    readinessGaps: (input.readinessGaps ?? []).map((item) => String(item).slice(0, 220)),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticSubmission: false,
    automaticComplianceClaims: false,
    automaticApproval: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceExamReadinessRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(evaluationInput) {
      const evaluation = normalizeComplianceExamReadinessEvaluation(evaluationInput)
      if (!database?.connected) return { ok: true, disabled: true, evaluation }
      const result = await database.query(
        `INSERT INTO atlas_compliance_exam_readiness_evaluations
          (id, organization_id, team_workspace_id, readiness_status, readiness_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET readiness_status = EXCLUDED.readiness_status, readiness_score = EXCLUDED.readiness_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [evaluation.id, evaluation.tenantScope.organizationId, evaluation.tenantScope.teamWorkspaceId, evaluation.readinessStatus, evaluation.readinessScore, evaluation],
      )
      return { ok: true, evaluation: normalizeComplianceExamReadinessEvaluation(result.rows?.[0]?.payload ?? evaluation) }
    },
    async list({ tenantContext = {}, readinessStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (readinessStatus) {
        params.push(safeStatus(readinessStatus))
        clauses.push(`readiness_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_exam_readiness_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceExamReadinessEvaluation(row.payload))
    },
  }
}

export function evaluateComplianceExamReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceExamReadinessEvaluations ?? []
  const auditReadiness = input.complianceAuditReadinessPackage ?? {}
  const externalReview = input.complianceExternalReviewPlanning ?? {}
  const retentionReview = input.complianceRecordRetentionReview ?? {}
  const risk = input.complianceRiskCommandCenter ?? {}
  const score = Math.max(0, Math.min(100, 100
    - ((auditReadiness.auditReadinessSummary?.needsUpdates ?? 0) * 20)
    - ((externalReview.externalReviewSummary?.needsUpdates ?? 0) * 15)
    - ((retentionReview.retentionReviewSummary?.reviewDue ?? 0) * 10)
    - (risk.commandCenterStatus === 'blocked' ? 30 : risk.commandCenterStatus === 'caution' ? 10 : 0)))
  const readinessStatus = score < 60 ? 'blocked' : score < 85 ? 'caution' : 'ready'
  const evaluations = (supplied.length ? supplied : [normalizeComplianceExamReadinessEvaluation({
    tenantContext,
    readinessStatus,
    readinessScore: score,
    examScopeSummary: `Compliance exam readiness references audit readiness, external review planning, retention review, and compliance risk command center outputs with a ${score} readiness score.`,
    sourceReferences: [
      { id: 'compliance-audit-readiness', type: 'compliance-audit-readiness-package', eventType: auditReadiness.eventType },
      { id: 'compliance-external-review', type: 'compliance-external-review-planning', eventType: externalReview.eventType },
      { id: 'compliance-record-retention', type: 'compliance-record-retention-review', eventType: retentionReview.eventType },
      { id: 'compliance-risk-command', type: 'compliance-risk-command-center', eventType: risk.eventType },
    ],
    readinessGaps: [
      ...(auditReadiness.auditReadinessSummary?.needsUpdates ? ['Audit readiness package needs updates'] : []),
      ...(externalReview.externalReviewSummary?.needsUpdates ? ['External review plan needs updates'] : []),
      ...(retentionReview.retentionReviewSummary?.reviewDue ? ['Retention review is due'] : []),
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceExamReadinessEvaluation)
  const examReadinessSummary = {
    total: evaluations.length,
    ready: evaluations.filter((item) => item.readinessStatus === 'ready').length,
    caution: evaluations.filter((item) => item.readinessStatus === 'caution').length,
    blocked: evaluations.filter((item) => item.readinessStatus === 'blocked').length,
    averageScore: evaluations.length ? Math.round(evaluations.reduce((sum, item) => sum + item.readinessScore, 0) / evaluations.length) : 0,
  }
  const examReadinessStatus = examReadinessSummary.blocked > 0 ? 'blocked' : examReadinessSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_EXAM_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceExamReadinessEvaluations: evaluations,
    examReadinessSummary,
    examReadinessStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticSubmission: false,
    automaticComplianceClaims: false,
    automaticApproval: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance exam readiness ${examReadinessStatus}: ${examReadinessSummary.ready} ready, ${examReadinessSummary.caution} caution, and ${examReadinessSummary.blocked} blocked evaluations.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_EXAM_READINESS_EVALUATED_EVENT, result)
  return result
}
