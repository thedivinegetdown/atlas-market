import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_ESCALATION_PLANNED_EVENT = 'system.complianceEscalation.planned'
export const SYSTEM_COMPLIANCE_ESCALATION_UPDATED_EVENT = 'system.complianceEscalation.updated'

export const ESCALATION_STATUSES = Object.freeze(['planned', 'acknowledged', 'in_review', 'resolved', 'deferred'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return ESCALATION_STATUSES.includes(status) ? status : 'planned'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

export function normalizeComplianceEscalationPlan(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-escalation-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    escalationStatus: safeStatus(input.escalationStatus ?? input.status),
    escalationSeverity: input.escalationSeverity ?? 'medium',
    escalationReason: String(input.escalationReason ?? 'Compliance review item requires human escalation review.').slice(0, 500),
    slaReferences: (input.slaReferences ?? []).map(normalizeReference),
    findingReferences: (input.findingReferences ?? []).map(normalizeReference),
    evidenceRequestReferences: (input.evidenceRequestReferences ?? []).map(normalizeReference),
    recommendedOwnerRole: input.recommendedOwnerRole ?? 'admin',
    recommendedAction: input.recommendedAction ?? 'review',
    plannedByUserId: input.plannedByUserId ?? tenantScope.userId ?? null,
    dueDate: input.dueDate ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticEscalationExecution: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    automaticEnforcementActions: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceEscalationPlanRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(planInput) {
      const plan = normalizeComplianceEscalationPlan(planInput)
      if (!database?.connected) return { ok: true, disabled: true, plan }
      const result = await database.query(
        `INSERT INTO atlas_compliance_escalation_plans
          (id, organization_id, team_workspace_id, escalation_status, escalation_severity, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET escalation_status = EXCLUDED.escalation_status, escalation_severity = EXCLUDED.escalation_severity, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [plan.id, plan.tenantScope.organizationId, plan.tenantScope.teamWorkspaceId, plan.escalationStatus, plan.escalationSeverity, plan.dueDate, plan],
      )
      return { ok: true, plan: normalizeComplianceEscalationPlan(result.rows?.[0]?.payload ?? plan) }
    },
    async list({ tenantContext = {}, escalationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (escalationStatus) {
        params.push(safeStatus(escalationStatus))
        clauses.push(`escalation_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_escalation_plans
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceEscalationPlan(row.payload))
    },
    async updateStatus({ id, tenantContext = {}, escalationStatus }) {
      const status = safeStatus(escalationStatus)
      if (!database?.connected) return { ok: true, disabled: true, plan: normalizeComplianceEscalationPlan({ id, tenantContext, escalationStatus: status }) }
      const result = await database.query(
        `UPDATE atlas_compliance_escalation_plans
         SET escalation_status = $4,
             payload = jsonb_set(payload, '{escalationStatus}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', status],
      )
      return { ok: result.rows?.length > 0, plan: result.rows?.[0]?.payload ? normalizeComplianceEscalationPlan(result.rows[0].payload) : null }
    },
  }
}

export function planComplianceEscalations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const slas = input.complianceReviewSla?.complianceReviewSlas ?? []
  const findings = input.complianceReviewFindingTracker?.complianceReviewFindings ?? []
  const requests = input.complianceEvidenceRequestQueue?.complianceEvidenceRequests ?? []
  const supplied = input.complianceEscalationPlans ?? []
  const generated = [
    ...slas.filter((item) => ['breached', 'at_risk'].includes(item.slaStatus) || item.slaSeverity === 'critical').map((sla) => normalizeComplianceEscalationPlan({
      tenantContext,
      id: `compliance-escalation-${sla.id}`,
      escalationStatus: 'planned',
      escalationSeverity: sla.slaStatus === 'breached' || sla.slaSeverity === 'critical' ? 'high' : 'medium',
      escalationReason: 'Compliance SLA requires owner/admin review before readiness decisions.',
      slaReferences: [{ id: sla.id, type: 'compliance-review-sla', eventType: input.complianceReviewSla?.eventType }],
      recommendedOwnerRole: sla.slaSeverity === 'critical' ? 'owner' : 'admin',
      recommendedAction: 'investigate',
      timestamp: options.timestamp,
    })),
    ...findings.filter((item) => item.findingSeverity === 'critical').map((finding) => normalizeComplianceEscalationPlan({
      tenantContext,
      id: `compliance-escalation-${finding.id}`,
      escalationStatus: 'planned',
      escalationSeverity: 'critical',
      escalationReason: 'Critical compliance review finding requires human escalation review.',
      findingReferences: [{ id: finding.id, type: 'compliance-review-finding', eventType: input.complianceReviewFindingTracker?.eventType }],
      recommendedOwnerRole: 'owner',
      recommendedAction: 'review',
      timestamp: options.timestamp,
    })),
    ...requests.filter((item) => item.requestPriority === 'critical').map((request) => normalizeComplianceEscalationPlan({
      tenantContext,
      id: `compliance-escalation-${request.id}`,
      escalationStatus: 'planned',
      escalationSeverity: 'critical',
      escalationReason: 'Critical evidence request requires owner/admin follow-up.',
      evidenceRequestReferences: [{ id: request.id, type: 'compliance-evidence-request', eventType: input.complianceEvidenceRequestQueue?.eventType }],
      recommendedOwnerRole: 'owner',
      recommendedAction: 'monitor',
      timestamp: options.timestamp,
    })),
  ]
  const plans = (supplied.length ? supplied : generated).map(normalizeComplianceEscalationPlan)
  const escalationSummary = {
    total: plans.length,
    planned: plans.filter((item) => item.escalationStatus === 'planned').length,
    inReview: plans.filter((item) => item.escalationStatus === 'in_review').length,
    resolved: plans.filter((item) => item.escalationStatus === 'resolved').length,
    critical: plans.filter((item) => item.escalationSeverity === 'critical').length,
    high: plans.filter((item) => item.escalationSeverity === 'high').length,
  }
  const escalationStatus = escalationSummary.critical > 0 ? 'blocked' : escalationSummary.planned > 0 || escalationSummary.high > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_ESCALATION_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceEscalationPlans: plans,
    escalationSummary,
    escalationStatus,
    humanReviewOnly: true,
    automaticEscalationExecution: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance escalation planning ${escalationStatus}: ${escalationSummary.planned} planned and ${escalationSummary.critical} critical.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_ESCALATION_PLANNED_EVENT, result)
  return result
}

export async function updateComplianceEscalationStatus(input = {}, options = {}) {
  const repository = options.repository ?? createComplianceEscalationPlanRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_COMPLIANCE_ESCALATION_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    plan: response.plan,
    requestedStatus: safeStatus(input.escalationStatus),
    status: response.ok ? 'updated' : 'blocked',
    automaticEscalationExecution: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_COMPLIANCE_ESCALATION_UPDATED_EVENT, result)
  return result
}
