import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_REVIEW_SLA_EVALUATED_EVENT = 'system.complianceReviewSla.evaluated'

export const SLA_STATUSES = Object.freeze(['on_track', 'at_risk', 'breached', 'waived'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return SLA_STATUSES.includes(status) ? status : 'on_track'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

function daysUntil(dueDate, now) {
  if (!dueDate) return 7
  const due = new Date(dueDate)
  const current = new Date(now)
  if (Number.isNaN(due.getTime()) || Number.isNaN(current.getTime())) return 7
  return Math.ceil((due.getTime() - current.getTime()) / 86_400_000)
}

export function normalizeComplianceReviewSla(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-review-sla-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    slaStatus: safeStatus(input.slaStatus ?? input.status),
    slaSeverity: input.slaSeverity ?? 'medium',
    dueDate: input.dueDate ?? null,
    daysRemaining: Number(input.daysRemaining ?? 7),
    reviewReferences: (input.reviewReferences ?? []).map(normalizeReference),
    evidenceRequestReferences: (input.evidenceRequestReferences ?? []).map(normalizeReference),
    findingReferences: (input.findingReferences ?? []).map(normalizeReference),
    summary: String(input.summary ?? 'Compliance review SLA evaluated for human follow-up.').slice(0, 500),
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticEscalation: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceReviewSlaRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(slaInput) {
      const sla = normalizeComplianceReviewSla(slaInput)
      if (!database?.connected) return { ok: true, disabled: true, sla }
      const result = await database.query(
        `INSERT INTO atlas_compliance_review_sla_evaluations
          (id, organization_id, team_workspace_id, sla_status, sla_severity, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET sla_status = EXCLUDED.sla_status, sla_severity = EXCLUDED.sla_severity, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [sla.id, sla.tenantScope.organizationId, sla.tenantScope.teamWorkspaceId, sla.slaStatus, sla.slaSeverity, sla.dueDate, sla],
      )
      return { ok: true, sla: normalizeComplianceReviewSla(result.rows?.[0]?.payload ?? sla) }
    },
    async list({ tenantContext = {}, slaStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (slaStatus) {
        params.push(safeStatus(slaStatus))
        clauses.push(`sla_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_review_sla_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceReviewSla(row.payload))
    },
  }
}

export function evaluateComplianceReviewSla(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const now = options.timestamp ?? getNowIso()
  const workflows = input.complianceReviewWorkflow?.complianceReviewWorkflows ?? []
  const requests = input.complianceEvidenceRequestQueue?.complianceEvidenceRequests ?? []
  const findings = input.complianceReviewFindingTracker?.complianceReviewFindings ?? []
  const supplied = input.complianceReviewSlas ?? []
  const generated = [
    ...workflows.filter((item) => ['queued', 'in_review', 'changes_requested'].includes(item.reviewStatus)).map((workflow) => {
      const remaining = daysUntil(workflow.dueDate, now)
      return normalizeComplianceReviewSla({
        tenantContext,
        id: `compliance-review-sla-${workflow.id}`,
        slaStatus: remaining < 0 ? 'breached' : remaining <= 2 ? 'at_risk' : 'on_track',
        slaSeverity: workflow.reviewStatus === 'changes_requested' ? 'high' : 'medium',
        dueDate: workflow.dueDate,
        daysRemaining: remaining,
        reviewReferences: [{ id: workflow.id, type: 'compliance-review-workflow', eventType: input.complianceReviewWorkflow?.eventType }],
        summary: 'Compliance review workflow SLA evaluated for operator follow-up.',
        timestamp: now,
      })
    }),
    ...requests.filter((item) => ['open', 'in_progress', 'needs_clarification'].includes(item.requestStatus)).map((request) => {
      const remaining = daysUntil(request.dueDate, now)
      return normalizeComplianceReviewSla({
        tenantContext,
        id: `compliance-review-sla-${request.id}`,
        slaStatus: remaining < 0 ? 'breached' : request.requestPriority === 'high' || remaining <= 2 ? 'at_risk' : 'on_track',
        slaSeverity: request.requestPriority === 'critical' ? 'critical' : request.requestPriority,
        dueDate: request.dueDate,
        daysRemaining: remaining,
        evidenceRequestReferences: [{ id: request.id, type: 'compliance-evidence-request', eventType: input.complianceEvidenceRequestQueue?.eventType }],
        summary: 'Compliance evidence request SLA evaluated for evidence follow-up.',
        timestamp: now,
      })
    }),
    ...findings.filter((item) => item.findingStatus === 'open').map((finding) => {
      const remaining = daysUntil(finding.dueDate, now)
      return normalizeComplianceReviewSla({
        tenantContext,
        id: `compliance-review-sla-${finding.id}`,
        slaStatus: remaining < 0 ? 'breached' : finding.findingSeverity === 'critical' || remaining <= 2 ? 'at_risk' : 'on_track',
        slaSeverity: finding.findingSeverity === 'critical' ? 'critical' : 'medium',
        dueDate: finding.dueDate,
        daysRemaining: remaining,
        findingReferences: [{ id: finding.id, type: 'compliance-review-finding', eventType: input.complianceReviewFindingTracker?.eventType }],
        summary: 'Compliance review finding SLA evaluated for reviewer follow-up.',
        timestamp: now,
      })
    }),
  ]
  const slas = (supplied.length ? supplied : generated).map(normalizeComplianceReviewSla)
  const slaSummary = {
    total: slas.length,
    onTrack: slas.filter((item) => item.slaStatus === 'on_track').length,
    atRisk: slas.filter((item) => item.slaStatus === 'at_risk').length,
    breached: slas.filter((item) => item.slaStatus === 'breached').length,
    critical: slas.filter((item) => item.slaSeverity === 'critical').length,
  }
  const slaHealth = slaSummary.breached > 0 || slaSummary.critical > 0 ? 'blocked' : slaSummary.atRisk > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_REVIEW_SLA_EVALUATED_EVENT,
    timestamp: now,
    complianceReviewSlas: slas,
    slaSummary,
    slaHealth,
    advisoryOnly: true,
    humanReviewOnly: true,
    automaticEscalation: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance review SLA ${slaHealth}: ${slaSummary.atRisk} at risk and ${slaSummary.breached} breached.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_REVIEW_SLA_EVALUATED_EVENT, result)
  return result
}
