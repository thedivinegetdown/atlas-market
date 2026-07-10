import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_EVIDENCE_GOVERNANCE_REVIEWED_EVENT = 'system.evidenceGovernance.reviewed'
export const SYSTEM_EVIDENCE_GOVERNANCE_HEALTH_EVALUATED_EVENT = 'system.evidenceGovernance.healthEvaluated'

export const INTEGRITY_STATUSES = Object.freeze(['verified', 'partially_verified', 'unverified', 'disputed'])
export const GOVERNANCE_STATUSES = Object.freeze(['healthy', 'review_required', 'retention_due', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function addDays(isoDate, days) {
  const date = new Date(isoDate)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function ageDays(fromIso, nowIso) {
  const from = new Date(fromIso).getTime()
  const now = new Date(nowIso).getTime()
  if (Number.isNaN(from) || Number.isNaN(now)) return 0
  return Math.max(0, Math.floor((now - from) / 86400000))
}

function riskFrom(findings = []) {
  if (findings.some((finding) => finding.severity === 'critical')) return 'critical'
  if (findings.some((finding) => finding.severity === 'high')) return 'high'
  if (findings.some((finding) => finding.severity === 'caution')) return 'caution'
  return 'low'
}

function statusFrom({ integrityStatus, retentionDue, findings }) {
  if (findings.some((finding) => finding.severity === 'critical')) return 'blocked'
  if (retentionDue) return 'retention_due'
  if (['unverified', 'disputed'].includes(integrityStatus) || findings.length > 0) return 'review_required'
  return 'healthy'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    eventType: reference.eventType ?? null,
  }
}

export function normalizeEvidenceGovernanceEvaluation(input = {}) {
  const now = input.evaluatedAt ?? input.timestamp ?? getNowIso()
  const evidence = input.evidence ?? input
  const tenantScope = evidence.tenantScope ?? input.tenantScope ?? {}
  const sourceReference = normalizeReference(evidence.sourceEventReference ?? input.sourceEventReference)
  const evidenceAgeDays = Number(input.evidenceAgeDays ?? ageDays(evidence.collectedAt ?? now, now))
  const retentionClass = evidence.retentionClassification ?? input.retentionClass ?? 'administrative-review'
  const retentionReviewDate = input.retentionReviewDate ?? addDays(evidence.collectedAt ?? now, retentionClass === 'short-review' ? 30 : 365)
  const retentionDue = new Date(retentionReviewDate).getTime() <= new Date(now).getTime()
  const duplicateReferenceCount = Number(input.duplicateReferenceCount ?? 0)
  const findings = [
    !sourceReference.eventType ? { code: 'missing-source-event', severity: 'high', summary: 'Evidence is missing a source event reference.' } : null,
    evidence.redactionState !== 'redacted' ? { code: 'redaction-review-required', severity: 'critical', summary: 'Evidence redaction state requires review.' } : null,
    !retentionClass ? { code: 'missing-retention-classification', severity: 'caution', summary: 'Evidence retention classification is missing.' } : null,
    !evidence.relatedCaseId ? { code: 'orphaned-evidence', severity: 'caution', summary: 'Evidence is not linked to an administrative case.' } : null,
    !evidence.collectedByUserId ? { code: 'missing-collector', severity: 'caution', summary: 'Evidence collector metadata is incomplete.' } : null,
    duplicateReferenceCount > 0 ? { code: 'duplicate-source-reference', severity: 'caution', summary: 'Evidence source reference appears more than once.' } : null,
    retentionDue ? { code: 'retention-review-due', severity: 'high', summary: 'Evidence retention review date is due.' } : null,
  ].filter(Boolean)
  const integrityStatus = input.integrityStatus
    ?? (evidence.evidenceIntegrityMetadata?.sourceReferencePreserved === false ? 'disputed' : !sourceReference.eventType ? 'unverified' : findings.length > 0 ? 'partially_verified' : 'verified')
  const governanceStatus = statusFrom({ integrityStatus, retentionDue, findings })

  return {
    id: String(input.id ?? `evidence-governance-${evidence.id ?? Date.now()}`),
    evidenceId: evidence.id ?? input.evidenceId ?? null,
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    relatedCaseId: evidence.relatedCaseId ?? input.relatedCaseId ?? null,
    sourceEventReference: sourceReference,
    integrityStatus,
    traceabilityStatus: sourceReference.eventType ? 'traceable' : 'missing_reference',
    redactionStatus: evidence.redactionState === 'redacted' ? 'compliant' : 'review_required',
    retentionClass,
    retentionReviewDate,
    reviewStatus: evidence.humanReviewStatus ?? input.reviewStatus ?? 'awaiting_review',
    evidenceAgeDays,
    governanceFindings: findings,
    confidence: Math.min(1, Math.max(0, Number(input.confidence ?? evidence.confidence ?? 0.75))),
    riskLevel: riskFrom(findings),
    governanceStatus,
    humanReviewRecommendation: governanceStatus === 'healthy' ? 'monitor' : 'owner/admin review required',
    auditReferences: (input.auditReferences ?? []).map(normalizeReference),
    evaluatedAt: now,
    sensitiveMaterialExcluded: true,
    preservesEvidenceByReference: true,
    automaticDeletion: false,
    automaticRetentionMutation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createEvidenceGovernanceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(evaluationInput) {
      const evaluation = normalizeEvidenceGovernanceEvaluation(evaluationInput)
      if (!database?.connected) return { ok: true, disabled: true, evaluation }
      const result = await database.query(
        `INSERT INTO atlas_evidence_governance_evaluations
          (id, organization_id, team_workspace_id, evidence_id, related_case_id, governance_status, risk_level, retention_review_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET governance_status = EXCLUDED.governance_status, risk_level = EXCLUDED.risk_level, retention_review_date = EXCLUDED.retention_review_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          evaluation.id,
          evaluation.tenantScope.organizationId,
          evaluation.tenantScope.teamWorkspaceId,
          evaluation.evidenceId,
          evaluation.relatedCaseId,
          evaluation.governanceStatus,
          evaluation.riskLevel,
          evaluation.retentionReviewDate,
          evaluation,
        ],
      )
      return { ok: true, evaluation: normalizeEvidenceGovernanceEvaluation(result.rows?.[0]?.payload ?? evaluation) }
    },
    async list({ tenantContext = {}, governanceStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (governanceStatus) {
        params.push(GOVERNANCE_STATUSES.includes(governanceStatus) ? governanceStatus : 'review_required')
        clauses.push(`governance_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_evidence_governance_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeEvidenceGovernanceEvaluation(row.payload))
    },
  }
}

export function evaluateEvidenceGovernance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const evidence = input.administrativeEvidence?.administrativeEvidence ?? input.evidence ?? []
  const seenReferences = new Map()
  for (const item of evidence) {
    const key = `${item.sourceEventReference?.eventType ?? 'missing'}:${item.sourceEventReference?.id ?? item.id}`
    seenReferences.set(key, (seenReferences.get(key) ?? 0) + 1)
  }
  const evidenceGovernanceEvaluations = evidence.map((item) => {
    const key = `${item.sourceEventReference?.eventType ?? 'missing'}:${item.sourceEventReference?.id ?? item.id}`
    return normalizeEvidenceGovernanceEvaluation({
      evidence: item,
      duplicateReferenceCount: Math.max(0, (seenReferences.get(key) ?? 1) - 1),
      timestamp: now,
    })
  })
  const governanceSummary = {
    total: evidenceGovernanceEvaluations.length,
    healthy: evidenceGovernanceEvaluations.filter((item) => item.governanceStatus === 'healthy').length,
    reviewRequired: evidenceGovernanceEvaluations.filter((item) => item.governanceStatus === 'review_required').length,
    retentionDue: evidenceGovernanceEvaluations.filter((item) => item.governanceStatus === 'retention_due').length,
    blocked: evidenceGovernanceEvaluations.filter((item) => item.governanceStatus === 'blocked').length,
    unverifiedOrDisputed: evidenceGovernanceEvaluations.filter((item) => ['unverified', 'disputed'].includes(item.integrityStatus)).length,
    orphanedEvidence: evidenceGovernanceEvaluations.filter((item) => item.governanceFindings.some((finding) => finding.code === 'orphaned-evidence')).length,
    duplicateEvidenceReferences: evidenceGovernanceEvaluations.filter((item) => item.governanceFindings.some((finding) => finding.code === 'duplicate-source-reference')).length,
  }
  const governanceStatus = governanceSummary.blocked > 0 ? 'blocked' : governanceSummary.reviewRequired > 0 || governanceSummary.retentionDue > 0 ? 'review_required' : 'healthy'
  const result = {
    eventType: SYSTEM_EVIDENCE_GOVERNANCE_REVIEWED_EVENT,
    timestamp: now,
    evidenceGovernanceEvaluations,
    governanceSummary,
    governanceStatus,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    preservesEvidenceByReference: true,
    automaticDeletion: false,
    automaticRetentionMutation: false,
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Evidence governance ${governanceStatus}: ${governanceSummary.reviewRequired} review-required items and ${governanceSummary.retentionDue} retention reviews due.`,
    sourceEvents: {
      administrativeEvidence: input.administrativeEvidence?.eventType ?? null,
      administrativeCases: input.administrativeCases?.eventType ?? null,
      administrativeAudit: input.administrativeAudit?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_EVIDENCE_GOVERNANCE_REVIEWED_EVENT, result)
  return result
}
