import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_EVIDENCE_PACKAGE_PREPARED_EVENT = 'system.complianceEvidencePackage.prepared'

export const PACKAGE_STATUSES = Object.freeze(['draft', 'ready_for_review', 'reviewed', 'needs_updates', 'archived'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return PACKAGE_STATUSES.includes(status) ? status : 'draft'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.policyId ?? reference.controlId ?? reference.evidenceId ?? null,
    type: reference.type ?? reference.evidenceType ?? 'reference',
    eventType: reference.eventType ?? reference.sourceEventReference?.eventType ?? null,
  }
}

export function normalizeComplianceEvidencePackage(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-evidence-package-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    packageName: String(input.packageName ?? 'Administrative compliance readiness evidence package').slice(0, 180),
    packageStatus: safeStatus(input.packageStatus ?? input.status),
    policyReferences: (input.policyReferences ?? []).map(normalizeReference),
    controlReferences: (input.controlReferences ?? []).map(normalizeReference),
    attestationReferences: (input.attestationReferences ?? []).map(normalizeReference),
    controlTestReferences: (input.controlTestReferences ?? []).map(normalizeReference),
    exceptionReferences: (input.exceptionReferences ?? []).map(normalizeReference),
    evidenceGovernanceReferences: (input.evidenceGovernanceReferences ?? []).map(normalizeReference),
    remediationReferences: (input.remediationReferences ?? []).map(normalizeReference),
    auditReferences: (input.auditReferences ?? []).map(normalizeReference),
    safeSummary: String(input.safeSummary ?? 'Evidence package references normalized administrative governance outputs for human review.').slice(0, 500),
    completenessScore: Math.min(1, Math.max(0, Number(input.completenessScore ?? 0.75))),
    preparedByUserId: input.preparedByUserId ?? tenantScope.userId ?? null,
    preparedAt: now,
    updatedAt: input.updatedAt ?? now,
    exportReady: input.exportReady === true,
    referenceOnly: true,
    sensitivePayloadCopied: false,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceEvidencePackageRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(packageInput) {
      const evidencePackage = normalizeComplianceEvidencePackage(packageInput)
      if (!database?.connected) return { ok: true, disabled: true, evidencePackage }
      const result = await database.query(
        `INSERT INTO atlas_compliance_evidence_packages
          (id, organization_id, team_workspace_id, package_status, completeness_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET package_status = EXCLUDED.package_status, completeness_score = EXCLUDED.completeness_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [evidencePackage.id, evidencePackage.tenantScope.organizationId, evidencePackage.tenantScope.teamWorkspaceId, evidencePackage.packageStatus, evidencePackage.completenessScore, evidencePackage],
      )
      return { ok: true, evidencePackage: normalizeComplianceEvidencePackage(result.rows?.[0]?.payload ?? evidencePackage) }
    },
    async list({ tenantContext = {}, packageStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (packageStatus) {
        params.push(safeStatus(packageStatus))
        clauses.push(`package_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_evidence_packages
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceEvidencePackage(row.payload))
    },
  }
}

export function prepareComplianceEvidencePackage(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const policies = input.policyGovernance?.administrativePolicies ?? []
  const controls = input.controlAssurance?.controlAssuranceEvaluations ?? []
  const attestations = input.policyAttestation?.policyAttestations ?? []
  const tests = input.controlTesting?.controlTests ?? []
  const exceptions = input.controlAssurance?.policyExceptions ?? []
  const packages = (input.evidencePackages?.length ? input.evidencePackages : [normalizeComplianceEvidencePackage({
    tenantContext,
    policyReferences: policies.map((policy) => ({ id: policy.id, type: 'administrative-policy', eventType: input.policyGovernance?.eventType })),
    controlReferences: controls.map((control) => ({ id: control.controlId, type: 'control-assurance', eventType: input.controlAssurance?.eventType })),
    attestationReferences: attestations.map((item) => ({ id: item.id, type: 'policy-attestation', eventType: input.policyAttestation?.eventType })),
    controlTestReferences: tests.map((item) => ({ id: item.id, type: 'control-test', eventType: input.controlTesting?.eventType })),
    exceptionReferences: exceptions.map((item) => ({ id: item.id, type: 'policy-exception', eventType: input.controlAssurance?.eventType })),
    evidenceGovernanceReferences: input.evidenceGovernance?.evidenceGovernanceEvaluations?.map((item) => ({ id: item.id, type: 'evidence-governance', eventType: input.evidenceGovernance?.eventType })) ?? [],
    remediationReferences: input.remediationEffectiveness?.remediationEffectivenessEvaluations?.map((item) => ({ id: item.id, type: 'remediation-effectiveness', eventType: input.remediationEffectiveness?.eventType })) ?? [],
    completenessScore: policies.length && controls.length && attestations.length && tests.length ? 0.9 : 0.6,
    packageStatus: policies.length && controls.length ? 'ready_for_review' : 'draft',
    timestamp: options.timestamp,
  })]).map(normalizeComplianceEvidencePackage)
  const packageSummary = {
    total: packages.length,
    readyForReview: packages.filter((item) => item.packageStatus === 'ready_for_review').length,
    needsUpdates: packages.filter((item) => item.packageStatus === 'needs_updates').length,
    reviewed: packages.filter((item) => item.packageStatus === 'reviewed').length,
    averageCompleteness: packages.length ? packages.reduce((sum, item) => sum + item.completenessScore, 0) / packages.length : 0,
  }
  const packageStatus = packageSummary.needsUpdates > 0 ? 'blocked' : packageSummary.readyForReview > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_EVIDENCE_PACKAGE_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceEvidencePackages: packages,
    packageSummary,
    packageStatus,
    referenceOnly: true,
    sensitivePayloadCopied: false,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance evidence packages ${packageStatus}: ${packageSummary.readyForReview} ready for review with ${(packageSummary.averageCompleteness * 100).toFixed(0)}% average completeness.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_EVIDENCE_PACKAGE_PREPARED_EVENT, result)
  return result
}
