import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_CONTROL_ASSURANCE_REVIEWED_EVENT = 'system.controlAssurance.reviewed'
export const SYSTEM_POLICY_EXCEPTION_UPDATED_EVENT = 'system.policyException.updated'

export const CONTROL_STATUSES = Object.freeze(['effective', 'partially_effective', 'ineffective', 'not_evaluated'])
export const ASSURANCE_LEVELS = Object.freeze(['strong', 'moderate', 'weak', 'unknown'])
export const EXCEPTION_STATUSES = Object.freeze(['open', 'acknowledged', 'approved_temporarily', 'remediation_planned', 'resolved', 'expired'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function addDays(isoDate, days) {
  const date = new Date(isoDate)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function safeControlStatus(status) {
  return CONTROL_STATUSES.includes(status) ? status : 'not_evaluated'
}

function safeAssurance(level) {
  return ASSURANCE_LEVELS.includes(level) ? level : 'unknown'
}

function safeExceptionStatus(status) {
  return EXCEPTION_STATUSES.includes(status) ? status : 'open'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.controlId ?? reference.policyId ?? null,
    type: reference.type ?? reference.evidenceType ?? 'reference',
    eventType: reference.eventType ?? reference.sourceEventReference?.eventType ?? null,
  }
}

function assuranceFrom({ evidenceCoverage, openFindingCount, exceptionCount }) {
  if (evidenceCoverage >= 0.8 && openFindingCount === 0 && exceptionCount === 0) return 'strong'
  if (evidenceCoverage >= 0.5 && openFindingCount <= 1) return 'moderate'
  if (evidenceCoverage > 0 || openFindingCount > 0 || exceptionCount > 0) return 'weak'
  return 'unknown'
}

function statusFrom(level, openFindingCount, exceptionSeverity) {
  if (exceptionSeverity === 'critical' || openFindingCount > 2) return 'ineffective'
  if (level === 'strong') return 'effective'
  if (level === 'moderate') return 'partially_effective'
  return level === 'weak' ? 'ineffective' : 'not_evaluated'
}

export function normalizePolicyException(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const exceptionStatus = safeExceptionStatus(input.exceptionStatus ?? input.status)
  return {
    id: String(input.id ?? `policy-exception-${input.controlId ?? input.policyId ?? Date.now()}`),
    policyId: input.policyId ?? null,
    controlId: input.controlId ?? null,
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    exceptionStatus,
    exceptionSeverity: ['low', 'medium', 'high', 'critical'].includes(input.exceptionSeverity) ? input.exceptionSeverity : 'medium',
    exceptionOwnerUserId: input.exceptionOwnerUserId ?? tenantScope.userId ?? null,
    exceptionDueDate: input.exceptionDueDate ?? addDays(now, 30),
    exceptionSummary: String(input.exceptionSummary ?? 'Policy exception requires owner/admin review.').slice(0, 300),
    compensatingControlReferences: (input.compensatingControlReferences ?? []).map(normalizeReference),
    auditReferences: (input.auditReferences ?? []).map(normalizeReference),
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticResolution: false,
    automaticEnforcementActions: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function normalizeControlAssuranceEvaluation(input = {}) {
  const now = input.evaluatedAt ?? input.timestamp ?? getNowIso()
  const policy = input.policy ?? {}
  const tenantScope = policy.tenantScope ?? input.tenantScope ?? {}
  const evidenceCoverage = Math.min(1, Math.max(0, Number(input.evidenceCoverage ?? 0)))
  const openFindingCount = Number(input.openFindingCount ?? 0)
  const exceptionCount = Number(input.exceptionCount ?? 0)
  const exceptionSeverity = input.exceptionSeverity ?? (exceptionCount > 0 ? 'high' : 'low')
  const assuranceLevel = safeAssurance(input.assuranceLevel ?? assuranceFrom({ evidenceCoverage, openFindingCount, exceptionCount }))
  const controlStatus = safeControlStatus(input.controlStatus ?? statusFrom(assuranceLevel, openFindingCount, exceptionSeverity))
  const reviewDateMissing = !policy.reviewDate
  const controlOwnerMissing = !policy.policyOwnerUserId
  const findings = [
    evidenceCoverage === 0 ? 'control-without-evidence' : null,
    evidenceCoverage < 0.5 && evidenceCoverage > 0 ? 'stale-or-limited-evidence' : null,
    openFindingCount > 1 ? 'repeated-control-failures' : null,
    exceptionCount > 0 ? 'unresolved-policy-exceptions' : null,
    exceptionSeverity === 'critical' ? 'critical-exception-severity' : null,
    input.linkedIneffectiveRemediation ? 'linked-to-ineffective-remediation' : null,
    input.linkedCriticalResidualRisk ? 'linked-to-critical-residual-risk' : null,
    controlOwnerMissing ? 'missing-control-ownership' : null,
    reviewDateMissing ? 'missing-review-date' : null,
    !input.auditTraceable ? 'incomplete-audit-traceability' : null,
  ].filter(Boolean)
  return {
    id: String(input.id ?? `control-assurance-${policy.id ?? input.controlId ?? Date.now()}`),
    controlId: input.controlId ?? policy.controlReferences?.[0]?.id ?? `control-${policy.policyDomain ?? 'policy'}`,
    relatedPolicyId: policy.id ?? input.relatedPolicyId ?? input.policyId ?? null,
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    controlDomain: policy.policyDomain ?? input.controlDomain ?? 'audit completeness',
    controlObjective: String(input.controlObjective ?? `Assure ${policy.policyName ?? 'administrative policy'} control coverage.`).slice(0, 220),
    controlOwnerUserId: input.controlOwnerUserId ?? policy.policyOwnerUserId ?? null,
    controlStatus,
    assuranceLevel,
    evidenceCoverage,
    openFindingCount,
    exceptionCount,
    exceptionSeverity,
    exceptionOwnerUserId: input.exceptionOwnerUserId ?? policy.policyOwnerUserId ?? null,
    exceptionDueDate: input.exceptionDueDate ?? (exceptionCount > 0 ? addDays(now, 14) : null),
    compensatingControlReferences: (input.compensatingControlReferences ?? []).map(normalizeReference),
    reviewRecommendation: findings.length > 0 ? 'owner/admin control review required' : 'monitor',
    confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 0.78))),
    auditReferences: (input.auditReferences ?? []).map(normalizeReference),
    findings,
    evaluatedAt: now,
    humanReviewOnly: true,
    automaticExceptionApproval: false,
    automaticFindingResolution: false,
    automaticEnforcementActions: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createControlAssuranceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(evaluationInput) {
      const evaluation = normalizeControlAssuranceEvaluation(evaluationInput)
      if (!database?.connected) return { ok: true, disabled: true, evaluation }
      const result = await database.query(
        `INSERT INTO atlas_control_assurance_evaluations
          (id, organization_id, team_workspace_id, policy_id, control_id, control_status, assurance_level, exception_due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET control_status = EXCLUDED.control_status, assurance_level = EXCLUDED.assurance_level, exception_due_date = EXCLUDED.exception_due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [evaluation.id, evaluation.tenantScope.organizationId, evaluation.tenantScope.teamWorkspaceId, evaluation.relatedPolicyId, evaluation.controlId, evaluation.controlStatus, evaluation.assuranceLevel, evaluation.exceptionDueDate, evaluation],
      )
      return { ok: true, evaluation: normalizeControlAssuranceEvaluation(result.rows?.[0]?.payload ?? evaluation) }
    },
    async list({ tenantContext = {}, controlStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (controlStatus) {
        params.push(safeControlStatus(controlStatus))
        clauses.push(`control_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_control_assurance_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeControlAssuranceEvaluation(row.payload))
    },
  }
}

export function createPolicyExceptionRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(exceptionInput) {
      const exception = normalizePolicyException(exceptionInput)
      if (!database?.connected) return { ok: true, disabled: true, exception }
      const result = await database.query(
        `INSERT INTO atlas_policy_exceptions
          (id, organization_id, team_workspace_id, policy_id, control_id, exception_status, exception_severity, exception_due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET exception_status = EXCLUDED.exception_status, exception_severity = EXCLUDED.exception_severity, exception_due_date = EXCLUDED.exception_due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [exception.id, exception.tenantScope.organizationId, exception.tenantScope.teamWorkspaceId, exception.policyId, exception.controlId, exception.exceptionStatus, exception.exceptionSeverity, exception.exceptionDueDate, exception],
      )
      return { ok: true, exception: normalizePolicyException(result.rows?.[0]?.payload ?? exception) }
    },
    async list({ tenantContext = {}, exceptionStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (exceptionStatus) {
        params.push(safeExceptionStatus(exceptionStatus))
        clauses.push(`exception_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_policy_exceptions
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizePolicyException(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, exceptionStatus }) {
      const status = safeExceptionStatus(exceptionStatus)
      if (!database?.connected) return { ok: true, disabled: true, exception: normalizePolicyException({ id, tenantContext, exceptionStatus: status }) }
      const result = await database.query(
        `UPDATE atlas_policy_exceptions
         SET exception_status = $4,
             payload = jsonb_set(payload, '{exceptionStatus}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', status],
      )
      return { ok: result.rows?.length > 0, exception: result.rows?.[0]?.payload ? normalizePolicyException(result.rows[0].payload) : null }
    },
  }
}

export function evaluateControlAssurance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const policies = input.policyGovernance?.administrativePolicies ?? input.policies ?? []
  const evidenceSummary = input.evidenceGovernance?.governanceSummary ?? {}
  const effectivenessSummary = input.remediationEffectiveness?.effectivenessSummary ?? {}
  const exceptions = (input.policyExceptions ?? []).map(normalizePolicyException)
  const evaluations = policies.map((policy) => {
    const openFindingCount = Number(evidenceSummary.reviewRequired ?? 0) + Number(effectivenessSummary.followUpRequired ?? 0)
    const linkedIneffectiveRemediation = Number(effectivenessSummary.ineffective ?? 0) > 0
    const linkedCriticalResidualRisk = Number(effectivenessSummary.criticalResidualRisk ?? 0) > 0
    const policyExceptions = exceptions.filter((exception) => exception.policyId === policy.id && !['resolved'].includes(exception.exceptionStatus))
    return normalizeControlAssuranceEvaluation({
      policy,
      evidenceCoverage: policy.requiredEvidenceReferences.length > 0 ? 0.75 : 0,
      openFindingCount: policy.policyDomain === 'evidence governance' || policy.policyDomain === 'remediation effectiveness' ? openFindingCount : 0,
      exceptionCount: policyExceptions.length,
      exceptionSeverity: policyExceptions.some((exception) => exception.exceptionSeverity === 'critical') ? 'critical' : policyExceptions.length > 0 ? 'high' : 'low',
      linkedIneffectiveRemediation,
      linkedCriticalResidualRisk,
      auditTraceable: policy.auditReferences.length > 0 || policy.requiredEvidenceReferences.length > 0,
      timestamp: now,
    })
  })
  const assuranceSummary = {
    total: evaluations.length,
    effective: evaluations.filter((item) => item.controlStatus === 'effective').length,
    partiallyEffective: evaluations.filter((item) => item.controlStatus === 'partially_effective').length,
    ineffective: evaluations.filter((item) => item.controlStatus === 'ineffective').length,
    notEvaluated: evaluations.filter((item) => item.controlStatus === 'not_evaluated').length,
    controlsWithoutEvidence: evaluations.filter((item) => item.findings.includes('control-without-evidence')).length,
    weakOrUnknownAssurance: evaluations.filter((item) => ['weak', 'unknown'].includes(item.assuranceLevel)).length,
    openPolicyExceptions: exceptions.filter((item) => !['resolved'].includes(item.exceptionStatus)).length,
    expiredTemporaryExceptions: exceptions.filter((item) => item.exceptionStatus === 'expired').length,
    criticalExceptionSeverity: exceptions.filter((item) => item.exceptionSeverity === 'critical').length,
    repeatedControlFailures: evaluations.filter((item) => item.findings.includes('repeated-control-failures')).length,
    linkedIneffectiveRemediation: evaluations.filter((item) => item.findings.includes('linked-to-ineffective-remediation')).length,
    linkedCriticalResidualRisk: evaluations.filter((item) => item.findings.includes('linked-to-critical-residual-risk')).length,
  }
  const assuranceStatus = assuranceSummary.ineffective > 0 || assuranceSummary.criticalExceptionSeverity > 0 ? 'blocked' : assuranceSummary.weakOrUnknownAssurance > 0 || assuranceSummary.openPolicyExceptions > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_CONTROL_ASSURANCE_REVIEWED_EVENT,
    timestamp: now,
    controlAssuranceEvaluations: evaluations,
    policyExceptions: exceptions,
    assuranceSummary,
    assuranceStatus,
    humanReviewOnly: true,
    automaticExceptionApproval: false,
    automaticFindingResolution: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Control assurance ${assuranceStatus}: ${assuranceSummary.ineffective} ineffective controls and ${assuranceSummary.openPolicyExceptions} open exceptions.`,
    sourceEvents: {
      policyGovernance: input.policyGovernance?.eventType ?? null,
      evidenceGovernance: input.evidenceGovernance?.eventType ?? null,
      remediationEffectiveness: input.remediationEffectiveness?.eventType ?? null,
      accessReview: input.accessReview?.eventType ?? null,
      accessCertification: input.accessCertification?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_CONTROL_ASSURANCE_REVIEWED_EVENT, result)
  return result
}

export async function updatePolicyExceptionStatus(input = {}, options = {}) {
  const repository = options.repository ?? createPolicyExceptionRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_POLICY_EXCEPTION_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    exception: response.exception,
    requestedExceptionStatus: safeExceptionStatus(input.exceptionStatus),
    status: response.ok ? 'updated' : 'blocked',
    automaticExceptionApproval: false,
    automaticFindingResolution: false,
    automaticEnforcementActions: false,
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_POLICY_EXCEPTION_UPDATED_EVENT, result)
  return result
}
