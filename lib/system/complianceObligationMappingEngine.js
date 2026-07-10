import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_OBLIGATION_MAPPING_EVALUATED_EVENT = 'system.complianceObligationMapping.evaluated'

export const OBLIGATION_STATUSES = Object.freeze(['mapped', 'needs_evidence', 'under_review', 'satisfied', 'deferred'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return OBLIGATION_STATUSES.includes(status) ? status : 'mapped'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.policyId ?? reference.controlId ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

export function normalizeComplianceObligation(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-obligation-${tenantScope.organizationId ?? 'tenant'}-${input.policyId ?? (Date.parse(now) || Date.now())}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    obligationDomain: String(input.obligationDomain ?? input.policyDomain ?? 'administrative governance').slice(0, 120),
    obligationStatus: safeStatus(input.obligationStatus ?? input.status),
    obligationSummary: String(input.obligationSummary ?? 'Administrative compliance obligation mapped for evidence-based human review.').slice(0, 500),
    policyReferences: (input.policyReferences ?? []).map(normalizeReference),
    controlReferences: (input.controlReferences ?? []).map(normalizeReference),
    readinessReferences: (input.readinessReferences ?? []).map(normalizeReference),
    evidencePackageReferences: (input.evidencePackageReferences ?? []).map(normalizeReference),
    requiredEvidenceTypes: (input.requiredEvidenceTypes ?? ['policy', 'control', 'attestation', 'control-test']).map((item) => String(item).slice(0, 80)),
    evidenceCoverageScore: Math.min(1, Math.max(0, Number(input.evidenceCoverageScore ?? 0.5))),
    mappedByUserId: input.mappedByUserId ?? tenantScope.userId ?? null,
    mappedAt: input.mappedAt ?? now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticAttestation: false,
    automaticApproval: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceObligationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(obligationInput) {
      const obligation = normalizeComplianceObligation(obligationInput)
      if (!database?.connected) return { ok: true, disabled: true, obligation }
      const result = await database.query(
        `INSERT INTO atlas_compliance_obligations
          (id, organization_id, team_workspace_id, obligation_domain, obligation_status, evidence_coverage_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET obligation_domain = EXCLUDED.obligation_domain, obligation_status = EXCLUDED.obligation_status, evidence_coverage_score = EXCLUDED.evidence_coverage_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [obligation.id, obligation.tenantScope.organizationId, obligation.tenantScope.teamWorkspaceId, obligation.obligationDomain, obligation.obligationStatus, obligation.evidenceCoverageScore, obligation],
      )
      return { ok: true, obligation: normalizeComplianceObligation(result.rows?.[0]?.payload ?? obligation) }
    },
    async list({ tenantContext = {}, obligationStatus, obligationDomain, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (obligationStatus) {
        params.push(safeStatus(obligationStatus))
        clauses.push(`obligation_status = $${params.length}`)
      }
      if (obligationDomain) {
        params.push(String(obligationDomain).slice(0, 120))
        clauses.push(`obligation_domain = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_obligations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceObligation(row.payload))
    },
  }
}

export function evaluateComplianceObligationMapping(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const policies = input.policyGovernance?.administrativePolicies ?? []
  const controls = input.controlAssurance?.controlAssuranceEvaluations ?? []
  const packages = input.complianceEvidencePackage?.complianceEvidencePackages ?? []
  const supplied = input.complianceObligations ?? []
  const obligations = (supplied.length ? supplied : policies.slice(0, 6).map((policy, index) => {
    const relatedControls = controls.filter((control) => !control.policyId || control.policyId === policy.id).slice(0, 3)
    const coverageScore = packages.length > 0 && relatedControls.length > 0 ? 0.85 : relatedControls.length > 0 ? 0.65 : 0.45
    return normalizeComplianceObligation({
      tenantContext,
      id: `compliance-obligation-${policy.id ?? index}`,
      obligationDomain: policy.policyDomain ?? 'administrative governance',
      obligationStatus: coverageScore >= 0.8 ? 'mapped' : 'needs_evidence',
      obligationSummary: `Policy ${policy.id ?? index + 1} mapped to evidence requirements for advisory compliance review.`,
      policyReferences: [{ id: policy.id, type: 'administrative-policy', eventType: input.policyGovernance?.eventType }],
      controlReferences: relatedControls.map((control) => ({ id: control.controlId, type: 'control-assurance', eventType: input.controlAssurance?.eventType })),
      readinessReferences: [{ id: 'compliance-readiness-command', type: 'compliance-readiness', eventType: input.complianceReadinessCommandCenter?.eventType }],
      evidencePackageReferences: packages.map((item) => ({ id: item.id, type: 'compliance-evidence-package', eventType: input.complianceEvidencePackage?.eventType })),
      evidenceCoverageScore: coverageScore,
      timestamp: options.timestamp,
    })
  })).map(normalizeComplianceObligation)
  const obligationSummary = {
    total: obligations.length,
    mapped: obligations.filter((item) => item.obligationStatus === 'mapped').length,
    needsEvidence: obligations.filter((item) => item.obligationStatus === 'needs_evidence').length,
    underReview: obligations.filter((item) => item.obligationStatus === 'under_review').length,
    satisfied: obligations.filter((item) => item.obligationStatus === 'satisfied').length,
    averageCoverage: obligations.length ? obligations.reduce((sum, item) => sum + item.evidenceCoverageScore, 0) / obligations.length : 0,
  }
  const mappingStatus = obligationSummary.needsEvidence > 0 ? 'caution' : obligationSummary.total > 0 ? 'healthy' : 'blocked'
  const result = {
    eventType: SYSTEM_COMPLIANCE_OBLIGATION_MAPPING_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceObligations: obligations,
    obligationSummary,
    mappingStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticAttestation: false,
    automaticApproval: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance obligation mapping ${mappingStatus}: ${obligationSummary.mapped} mapped and ${obligationSummary.needsEvidence} needing evidence.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_OBLIGATION_MAPPING_EVALUATED_EVENT, result)
  return result
}
