import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT = 'system.administrativeEvidence.collected'
export const SYSTEM_ADMINISTRATIVE_EVIDENCE_REVIEW_UPDATED_EVENT = 'system.administrativeEvidence.reviewUpdated'

export const EVIDENCE_REVIEW_STATUSES = Object.freeze(['awaiting_review', 'reviewed', 'dismissed'])
const EVIDENCE_TYPES = Object.freeze(['audit', 'activity', 'session', 'access', 'certification', 'notification', 'workflow-sla', 'tenant-health', 'operator-attention', 'case', 'system-event'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeType(type) {
  return EVIDENCE_TYPES.includes(type) ? type : 'system-event'
}

function safeReviewStatus(status) {
  return EVIDENCE_REVIEW_STATUSES.includes(status) ? status : 'awaiting_review'
}

function safeSeverity(severity) {
  return ['informational', 'caution', 'high', 'critical'].includes(severity) ? severity : 'informational'
}

function evidenceId(prefix, id) {
  return `evidence-${prefix}-${String(id ?? Date.now()).replace(/[^A-Za-z0-9._:-]/g, '-')}`
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.workflowId ?? reference.caseId ?? null,
    eventType: reference.eventType ?? reference.sourceEventReference ?? null,
  }
}

export function normalizeAdministrativeEvidence(input = {}) {
  const collectedAt = input.collectedAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? evidenceId(input.evidenceType ?? input.type ?? 'system-event', input.sourceId ?? input.relatedCaseId)),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    relatedCaseId: input.relatedCaseId ?? input.caseId ?? null,
    evidenceType: safeType(input.evidenceType ?? input.type),
    sourceSystem: input.sourceSystem ?? input.sourceType ?? 'operator-intelligence',
    sourceEventReference: normalizeReference(input.sourceEventReference ?? input.source ?? {}),
    safeSummary: String(input.safeSummary ?? input.summary ?? 'Administrative evidence reference collected for review.').slice(0, 500),
    severity: safeSeverity(input.severity),
    confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 0.75))),
    collectedAt,
    collectedByUserId: input.collectedByUserId ?? tenantScope.userId ?? null,
    evidenceIntegrityMetadata: {
      sourceReferencePreserved: true,
      sensitivePayloadCopied: false,
      checksumPlaceholder: input.checksumPlaceholder ?? null,
    },
    redactionState: 'redacted',
    retentionClassification: input.retentionClassification ?? 'administrative-review',
    humanReviewStatus: safeReviewStatus(input.humanReviewStatus),
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createAdministrativeEvidenceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(evidenceInput) {
      const evidence = normalizeAdministrativeEvidence(evidenceInput)
      if (!database?.connected) return { ok: true, disabled: true, evidence }
      const result = await database.query(
        `INSERT INTO atlas_administrative_evidence
          (id, organization_id, team_workspace_id, related_case_id, evidence_type, severity, review_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET review_status = EXCLUDED.review_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          evidence.id,
          evidence.tenantScope.organizationId,
          evidence.tenantScope.teamWorkspaceId,
          evidence.relatedCaseId,
          evidence.evidenceType,
          evidence.severity,
          evidence.humanReviewStatus,
          evidence,
        ],
      )
      return { ok: true, evidence: normalizeAdministrativeEvidence(result.rows?.[0]?.payload ?? evidence) }
    },
    async list({ tenantContext = {}, relatedCaseId, reviewStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (relatedCaseId) {
        params.push(relatedCaseId)
        clauses.push(`related_case_id = $${params.length}`)
      }
      if (reviewStatus) {
        params.push(safeReviewStatus(reviewStatus))
        clauses.push(`review_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_administrative_evidence
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAdministrativeEvidence(row.payload))
    },
    async get({ id, tenantContext = {} }) {
      if (!database?.connected) return null
      const result = await database.query(
        `SELECT payload FROM atlas_administrative_evidence
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? ''],
      )
      return result.rows?.[0]?.payload ? normalizeAdministrativeEvidence(result.rows[0].payload) : null
    },
    async updateReviewStatus({ id, tenantContext = {}, reviewStatus }) {
      const safe = safeReviewStatus(reviewStatus)
      if (!database?.connected) return { ok: true, disabled: true, evidence: normalizeAdministrativeEvidence({ id, tenantContext, humanReviewStatus: safe }) }
      const result = await database.query(
        `UPDATE atlas_administrative_evidence
         SET review_status = $4,
             payload = jsonb_set(payload, '{humanReviewStatus}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', safe],
      )
      return { ok: result.rows?.length > 0, evidence: result.rows?.[0]?.payload ? normalizeAdministrativeEvidence(result.rows[0].payload) : null }
    },
  }
}

function fromAttention(item = {}, relatedCaseId, tenantContext = {}) {
  return normalizeAdministrativeEvidence({
    id: evidenceId('attention', item.id),
    tenantContext,
    relatedCaseId,
    evidenceType: 'operator-attention',
    sourceSystem: item.sourceType,
    sourceEventReference: { eventType: item.sourceEventReference, id: item.id },
    safeSummary: item.rationale,
    severity: item.severity,
    confidence: item.confidence,
  })
}

function fromCase(item = {}, tenantContext = {}) {
  return normalizeAdministrativeEvidence({
    id: evidenceId('case', item.id),
    tenantContext: item.tenantScope ?? tenantContext,
    relatedCaseId: item.id,
    evidenceType: 'case',
    sourceSystem: 'administrative-case-management',
    sourceEventReference: { eventType: 'system.administrativeCase.created', id: item.id },
    safeSummary: item.title,
    severity: item.priority === 'critical' ? 'critical' : item.priority === 'high' ? 'high' : 'caution',
    confidence: 0.8,
  })
}

export function collectAdministrativeEvidence(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const cases = input.administrativeCases?.administrativeCases ?? input.cases ?? []
  const attentionItems = input.operatorAttention?.rankedOperatorAttentionQueue ?? []
  const slaItems = input.administrationWorkflowSla?.workflowSlaItems ?? []
  const riskFindings = input.userActivityRiskReview?.activityRiskFindings ?? []
  const evidence = [
    ...cases.map((item) => fromCase(item, tenantContext)),
    ...attentionItems.map((item) => fromAttention(item, item.workflowReference ? `admin-case-${item.workflowReference}` : null, tenantContext)),
    ...slaItems.filter((item) => item.slaStatus !== 'within-sla').map((item) => normalizeAdministrativeEvidence({
      id: evidenceId('workflow-sla', item.workflowId),
      tenantContext,
      relatedCaseId: `admin-case-${item.workflowId}`,
      evidenceType: 'workflow-sla',
      sourceSystem: 'administration-workflow-sla',
      sourceEventReference: { eventType: input.administrationWorkflowSla?.eventType, id: item.workflowId },
      safeSummary: `${item.category} workflow ${item.slaStatus}.`,
      severity: item.slaStatus === 'breached' ? 'critical' : 'high',
      confidence: 0.9,
    })),
    ...riskFindings.map((finding) => normalizeAdministrativeEvidence({
      id: evidenceId('activity-risk', finding.id),
      tenantContext,
      evidenceType: 'activity',
      sourceSystem: 'user-activity-risk-review',
      sourceEventReference: { eventType: input.userActivityRiskReview?.eventType, id: finding.id },
      safeSummary: finding.summary,
      severity: finding.severity,
      confidence: 0.82,
    })),
  ]
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    administrativeEvidence: evidence,
    evidenceSummary: {
      total: evidence.length,
      awaitingReview: evidence.filter((item) => item.humanReviewStatus === 'awaiting_review').length,
      highConfidence: evidence.filter((item) => item.confidence >= 0.8).length,
      critical: evidence.filter((item) => item.severity === 'critical').length,
    },
    redactionState: 'redacted',
    sensitiveMaterialExcluded: true,
    externalCollection: false,
    surveillanceAdded: false,
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    status: evidence.some((item) => item.severity === 'critical') ? 'caution' : 'healthy',
    summary: `Administrative evidence collected ${evidence.length} safe references from existing systems.`,
    sourceEvents: {
      administrativeCases: input.administrativeCases?.eventType ?? null,
      operatorAttention: input.operatorAttention?.eventType ?? null,
      userActivityRiskReview: input.userActivityRiskReview?.eventType ?? null,
      administrationWorkflowSla: input.administrationWorkflowSla?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT, result)
  return result
}

export async function createAdministrativeEvidence(input = {}, options = {}) {
  const repository = options.repository ?? createAdministrativeEvidenceRepository(options)
  const response = await repository.create(input.evidence ?? input)
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    evidence: response.evidence,
    status: response.ok ? 'collected' : 'blocked',
    sensitiveMaterialExcluded: true,
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT, result)
  return result
}

export async function updateEvidenceReviewStatus(input = {}, options = {}) {
  const repository = options.repository ?? createAdministrativeEvidenceRepository(options)
  const response = await repository.updateReviewStatus(input)
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_EVIDENCE_REVIEW_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    evidence: response.evidence,
    requestedReviewStatus: safeReviewStatus(input.reviewStatus),
    status: response.ok ? 'updated' : 'blocked',
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_ADMINISTRATIVE_EVIDENCE_REVIEW_UPDATED_EVENT, result)
  return result
}
