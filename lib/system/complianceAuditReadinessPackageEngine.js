import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_AUDIT_READINESS_PREPARED_EVENT = 'system.complianceAuditReadiness.prepared'

export const AUDIT_READINESS_STATUSES = Object.freeze(['draft', 'ready_for_review', 'needs_updates', 'archived'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return AUDIT_READINESS_STATUSES.includes(status) ? status : 'draft'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

export function normalizeComplianceAuditReadinessPackage(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-audit-readiness-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    readinessStatus: safeStatus(input.readinessStatus ?? input.status),
    packageType: input.packageType ?? 'owner-admin-audit-readiness',
    completenessScore: clampScore(input.completenessScore ?? input.evidenceCompletenessScore),
    packageSummary: String(input.packageSummary ?? 'Compliance audit readiness package prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evidenceSummary: {
      packagesReady: Number(input.evidenceSummary?.packagesReady ?? input.packagesReady ?? 0),
      requestsOpen: Number(input.evidenceSummary?.requestsOpen ?? input.requestsOpen ?? 0),
      findingsOpen: Number(input.evidenceSummary?.findingsOpen ?? input.findingsOpen ?? 0),
      readoutsReady: Number(input.evidenceSummary?.readoutsReady ?? input.readoutsReady ?? 0),
    },
    reviewActions: (input.reviewActions ?? []).map((item) => String(item).slice(0, 220)),
    preparedByUserId: input.preparedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    referenceOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticExport: false,
    automaticSubmission: false,
    automaticApproval: false,
    automaticEnforcementActions: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceAuditReadinessPackageRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(packageInput) {
      const readinessPackage = normalizeComplianceAuditReadinessPackage(packageInput)
      if (!database?.connected) return { ok: true, disabled: true, readinessPackage }
      const result = await database.query(
        `INSERT INTO atlas_compliance_audit_readiness_packages
          (id, organization_id, team_workspace_id, readiness_status, completeness_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET readiness_status = EXCLUDED.readiness_status, completeness_score = EXCLUDED.completeness_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          readinessPackage.id,
          readinessPackage.tenantScope.organizationId,
          readinessPackage.tenantScope.teamWorkspaceId,
          readinessPackage.readinessStatus,
          readinessPackage.completenessScore,
          readinessPackage,
        ],
      )
      return { ok: true, readinessPackage: normalizeComplianceAuditReadinessPackage(result.rows?.[0]?.payload ?? readinessPackage) }
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
        `SELECT payload FROM atlas_compliance_audit_readiness_packages
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceAuditReadinessPackage(row.payload))
    },
  }
}

export function prepareComplianceAuditReadinessPackage(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceAuditReadinessPackages ?? []
  const evidencePackage = input.complianceEvidencePackage ?? {}
  const requests = input.complianceEvidenceRequestQueue?.requestSummary ?? {}
  const findings = input.complianceReviewFindingTracker?.findingSummary ?? {}
  const risk = input.complianceRiskCommandCenter ?? {}
  const readout = input.complianceGovernanceReadout ?? {}
  const completenessScore = clampScore(evidencePackage.packageSummary?.averageCompleteness ?? evidencePackage.completenessScore ?? 75)
  const needsUpdates = (requests.open ?? 0) > 0 || (findings.open ?? 0) > 0 || risk.commandCenterStatus === 'blocked'
  const packages = (supplied.length ? supplied : [normalizeComplianceAuditReadinessPackage({
    tenantContext,
    readinessStatus: needsUpdates ? 'needs_updates' : 'ready_for_review',
    completenessScore,
    packageSummary: `Compliance audit readiness package references ${requests.open ?? 0} open evidence requests, ${findings.open ?? 0} open findings, and ${readout.readoutSummary?.readyForReview ?? 0} governance readouts ready for review.`,
    sourceReferences: [
      { id: 'compliance-evidence-package', type: 'compliance-evidence-package', eventType: evidencePackage.eventType },
      { id: 'compliance-evidence-requests', type: 'compliance-evidence-request-queue', eventType: input.complianceEvidenceRequestQueue?.eventType },
      { id: 'compliance-review-findings', type: 'compliance-review-finding-tracker', eventType: input.complianceReviewFindingTracker?.eventType },
      { id: 'compliance-risk-command', type: 'compliance-risk-command-center', eventType: risk.eventType },
      { id: 'compliance-governance-readout', type: 'compliance-governance-readout', eventType: readout.eventType },
      { id: 'enterprise-audit-trail', type: 'enterprise-audit-trail', eventType: input.enterpriseAuditTrail?.eventType },
      { id: 'data-lineage', type: 'data-lineage', eventType: input.dataLineage?.eventType },
    ],
    evidenceSummary: {
      packagesReady: evidencePackage.packageSummary?.readyForReview ?? 0,
      requestsOpen: requests.open ?? 0,
      findingsOpen: findings.open ?? 0,
      readoutsReady: readout.readoutSummary?.readyForReview ?? 0,
    },
    reviewActions: ['Review evidence package completeness', 'Review open requests and findings', 'Confirm governance readout references'],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceAuditReadinessPackage)
  const auditReadinessSummary = {
    total: packages.length,
    readyForReview: packages.filter((item) => item.readinessStatus === 'ready_for_review').length,
    needsUpdates: packages.filter((item) => item.readinessStatus === 'needs_updates').length,
    archived: packages.filter((item) => item.readinessStatus === 'archived').length,
    averageCompleteness: packages.length ? Math.round(packages.reduce((sum, item) => sum + item.completenessScore, 0) / packages.length) : 0,
  }
  const auditReadinessStatus = auditReadinessSummary.needsUpdates > 0 ? 'caution' : auditReadinessSummary.readyForReview > 0 ? 'ready' : 'caution'
  const result = {
    eventType: SYSTEM_COMPLIANCE_AUDIT_READINESS_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceAuditReadinessPackages: packages,
    auditReadinessSummary,
    auditReadinessStatus,
    referenceOnly: true,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticExport: false,
    automaticSubmission: false,
    automaticApproval: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance audit readiness ${auditReadinessStatus}: ${auditReadinessSummary.readyForReview} ready for review and ${auditReadinessSummary.needsUpdates} needing updates.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_AUDIT_READINESS_PREPARED_EVENT, result)
  return result
}
