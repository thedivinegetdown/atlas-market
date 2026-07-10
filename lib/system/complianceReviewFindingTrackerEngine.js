import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_REVIEW_FINDING_TRACKED_EVENT = 'system.complianceReviewFinding.tracked'
export const SYSTEM_COMPLIANCE_REVIEW_FINDING_UPDATED_EVENT = 'system.complianceReviewFinding.updated'

export const REVIEW_FINDING_STATUSES = Object.freeze(['open', 'acknowledged', 'resolved', 'deferred', 'closed'])
export const REVIEW_FINDING_SEVERITIES = Object.freeze(['informational', 'caution', 'critical'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return REVIEW_FINDING_STATUSES.includes(status) ? status : 'open'
}

function safeSeverity(severity) {
  return REVIEW_FINDING_SEVERITIES.includes(severity) ? severity : 'informational'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

export function normalizeComplianceReviewFinding(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-review-finding-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    findingStatus: safeStatus(input.findingStatus ?? input.status),
    findingSeverity: safeSeverity(input.findingSeverity ?? input.severity),
    findingSummary: String(input.findingSummary ?? 'Compliance review finding tracked for human review.').slice(0, 500),
    workflowReferences: (input.workflowReferences ?? []).map(normalizeReference),
    evidenceRequestReferences: (input.evidenceRequestReferences ?? []).map(normalizeReference),
    obligationReferences: (input.obligationReferences ?? []).map(normalizeReference),
    remediationReferences: (input.remediationReferences ?? []).map(normalizeReference),
    ownerUserId: input.ownerUserId ?? tenantScope.userId ?? null,
    dueDate: input.dueDate ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticFindingResolution: false,
    automaticComplianceClaims: false,
    automaticApproval: false,
    automaticEnforcementActions: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceReviewFindingRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(findingInput) {
      const finding = normalizeComplianceReviewFinding(findingInput)
      if (!database?.connected) return { ok: true, disabled: true, finding }
      const result = await database.query(
        `INSERT INTO atlas_compliance_review_findings
          (id, organization_id, team_workspace_id, finding_status, finding_severity, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET finding_status = EXCLUDED.finding_status, finding_severity = EXCLUDED.finding_severity, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [finding.id, finding.tenantScope.organizationId, finding.tenantScope.teamWorkspaceId, finding.findingStatus, finding.findingSeverity, finding.dueDate, finding],
      )
      return { ok: true, finding: normalizeComplianceReviewFinding(result.rows?.[0]?.payload ?? finding) }
    },
    async list({ tenantContext = {}, findingStatus, findingSeverity, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (findingStatus) {
        params.push(safeStatus(findingStatus))
        clauses.push(`finding_status = $${params.length}`)
      }
      if (findingSeverity) {
        params.push(safeSeverity(findingSeverity))
        clauses.push(`finding_severity = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_review_findings
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceReviewFinding(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, findingStatus }) {
      const status = safeStatus(findingStatus)
      if (!database?.connected) return { ok: true, disabled: true, finding: normalizeComplianceReviewFinding({ id, tenantContext, findingStatus: status }) }
      const result = await database.query(
        `UPDATE atlas_compliance_review_findings
         SET finding_status = $4,
             payload = jsonb_set(payload, '{findingStatus}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', status],
      )
      return { ok: result.rows?.length > 0, finding: result.rows?.[0]?.payload ? normalizeComplianceReviewFinding(result.rows[0].payload) : null }
    },
  }
}

export function trackComplianceReviewFindings(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const workflows = input.complianceReviewWorkflow?.complianceReviewWorkflows ?? []
  const requests = input.complianceEvidenceRequestQueue?.complianceEvidenceRequests ?? []
  const obligations = input.complianceObligationMapping?.complianceObligations ?? []
  const supplied = input.complianceReviewFindings ?? []
  const generatedFindings = [
    ...workflows.filter((item) => item.reviewStatus === 'changes_requested').map((workflow) => normalizeComplianceReviewFinding({
      tenantContext,
      id: `compliance-review-finding-${workflow.id}`,
      findingSeverity: 'caution',
      findingStatus: 'open',
      findingSummary: 'Compliance review workflow requested changes before readiness can be reviewed.',
      workflowReferences: [{ id: workflow.id, type: 'compliance-review-workflow', eventType: input.complianceReviewWorkflow?.eventType }],
      timestamp: options.timestamp,
    })),
    ...requests.filter((item) => item.requestPriority === 'high' || item.requestPriority === 'critical').map((request) => normalizeComplianceReviewFinding({
      tenantContext,
      id: `compliance-review-finding-${request.id}`,
      findingSeverity: request.requestPriority === 'critical' ? 'critical' : 'caution',
      findingStatus: 'open',
      findingSummary: 'High-priority evidence request requires compliance reviewer follow-up.',
      evidenceRequestReferences: [{ id: request.id, type: 'compliance-evidence-request', eventType: input.complianceEvidenceRequestQueue?.eventType }],
      obligationReferences: request.obligationReferences,
      timestamp: options.timestamp,
    })),
    ...obligations.filter((item) => item.obligationStatus === 'needs_evidence').slice(0, 3).map((obligation) => normalizeComplianceReviewFinding({
      tenantContext,
      id: `compliance-review-finding-${obligation.id}`,
      findingSeverity: 'informational',
      findingStatus: 'open',
      findingSummary: 'Mapped obligation needs additional evidence before package completion.',
      obligationReferences: [{ id: obligation.id, type: 'compliance-obligation', eventType: input.complianceObligationMapping?.eventType }],
      timestamp: options.timestamp,
    })),
  ]
  const findings = (supplied.length ? supplied : generatedFindings).map(normalizeComplianceReviewFinding)
  const findingSummary = {
    total: findings.length,
    open: findings.filter((item) => item.findingStatus === 'open').length,
    acknowledged: findings.filter((item) => item.findingStatus === 'acknowledged').length,
    resolved: findings.filter((item) => item.findingStatus === 'resolved').length,
    critical: findings.filter((item) => item.findingSeverity === 'critical').length,
    caution: findings.filter((item) => item.findingSeverity === 'caution').length,
  }
  const trackerStatus = findingSummary.critical > 0 ? 'blocked' : findingSummary.open > 0 || findingSummary.caution > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_REVIEW_FINDING_TRACKED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceReviewFindings: findings,
    findingSummary,
    trackerStatus,
    humanReviewOnly: true,
    automaticFindingResolution: false,
    automaticComplianceClaims: false,
    automaticApproval: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance review finding tracker ${trackerStatus}: ${findingSummary.open} open and ${findingSummary.critical} critical findings.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_REVIEW_FINDING_TRACKED_EVENT, result)
  return result
}

export async function updateComplianceReviewFindingStatus(input = {}, options = {}) {
  const repository = options.repository ?? createComplianceReviewFindingRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_COMPLIANCE_REVIEW_FINDING_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    finding: response.finding,
    requestedStatus: safeStatus(input.findingStatus),
    status: response.ok ? 'updated' : 'blocked',
    automaticFindingResolution: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_COMPLIANCE_REVIEW_FINDING_UPDATED_EVENT, result)
  return result
}
