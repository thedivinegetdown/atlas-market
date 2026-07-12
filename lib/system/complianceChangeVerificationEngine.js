import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_CHANGE_VERIFICATION_REVIEWED_EVENT = 'system.complianceChangeVerification.reviewed'

export const VERIFICATION_STATUSES = Object.freeze(['verified', 'needs-review', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return VERIFICATION_STATUSES.includes(status) ? status : 'needs-review'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceChangeVerification(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-change-verification-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    verificationStatus: safeStatus(input.verificationStatus ?? input.status),
    verificationScore: Math.max(0, Math.min(100, Number(input.verificationScore ?? 0))),
    verificationSummaryText: String(input.verificationSummaryText ?? input.verificationSummary ?? 'Compliance change verification reviewed for human approval.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticVerification: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceChangeVerificationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const verification = normalizeComplianceChangeVerification(input)
      if (!database?.connected) return { ok: true, disabled: true, verification }
      const result = await database.query(
        `INSERT INTO atlas_compliance_change_verifications
          (id, organization_id, team_workspace_id, verification_status, verification_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET verification_status = EXCLUDED.verification_status, verification_score = EXCLUDED.verification_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [verification.id, verification.tenantScope.organizationId, verification.tenantScope.teamWorkspaceId, verification.verificationStatus, verification.verificationScore, verification],
      )
      return { ok: true, verification: normalizeComplianceChangeVerification(result.rows?.[0]?.payload ?? verification) }
    },
    async list({ tenantContext = {}, verificationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (verificationStatus) {
        params.push(safeStatus(verificationStatus))
        clauses.push(`verification_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_change_verifications
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceChangeVerification(row.payload))
    },
  }
}

export function reviewComplianceChangeVerification(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceChangeVerifications ?? []
  const progress = input.complianceImplementationProgress ?? {}
  const evidence = input.complianceEvidenceRequestQueue ?? {}
  const progressScore = progress.progressSummary?.averageProgressScore ?? 0
  const openEvidence = evidence.evidenceRequestSummary?.open ?? evidence.requestSummary?.open ?? 0
  const score = Math.max(0, Math.min(100, progressScore - openEvidence * 8))
  const verificationStatus = score >= 85 ? 'verified' : score >= 60 ? 'needs-review' : 'blocked'
  const verifications = (supplied.length ? supplied : [normalizeComplianceChangeVerification({
    tenantContext,
    verificationStatus,
    verificationScore: score,
    verificationSummaryText: `Compliance change verification references progress score ${progressScore} and ${openEvidence} open evidence requests.`,
    sourceReferences: [
      { id: 'compliance-implementation-progress', type: 'compliance-implementation-progress', eventType: progress.eventType },
      { id: 'compliance-evidence-request-queue', type: 'compliance-evidence-request-queue', eventType: evidence.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceChangeVerification)
  const verificationSummary = {
    total: verifications.length,
    verified: verifications.filter((item) => item.verificationStatus === 'verified').length,
    needsReview: verifications.filter((item) => item.verificationStatus === 'needs-review').length,
    blocked: verifications.filter((item) => item.verificationStatus === 'blocked').length,
    averageVerificationScore: verifications.length ? Math.round(verifications.reduce((sum, item) => sum + item.verificationScore, 0) / verifications.length) : 0,
  }
  const changeVerificationStatus = verificationSummary.blocked > 0 ? 'blocked' : verificationSummary.needsReview > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_COMPLIANCE_CHANGE_VERIFICATION_REVIEWED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceChangeVerifications: verifications,
    verificationSummary,
    changeVerificationStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticVerification: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance change verification ${changeVerificationStatus}: average verification score ${verificationSummary.averageVerificationScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_CHANGE_VERIFICATION_REVIEWED_EVENT, result)
  return result
}
