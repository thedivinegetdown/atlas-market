import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_GOVERNANCE_DECISION_RECORDED_EVENT = 'system.complianceGovernanceDecision.recorded'

export const GOVERNANCE_DECISION_STATUSES = Object.freeze(['draft', 'recorded', 'needs_review', 'superseded'])
export const GOVERNANCE_DECISION_TYPES = Object.freeze(['audit-readiness', 'external-review', 'governance-readout', 'risk-acceptance'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return GOVERNANCE_DECISION_STATUSES.includes(status) ? status : 'draft'
}

function safeType(type) {
  return GOVERNANCE_DECISION_TYPES.includes(type) ? type : 'governance-readout'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceGovernanceDecision(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-governance-decision-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    decisionType: safeType(input.decisionType ?? input.type),
    decisionStatus: safeStatus(input.decisionStatus ?? input.status),
    decisionSummary: String(input.decisionSummary ?? 'Compliance governance decision logged for human review.').slice(0, 700),
    decisionRationale: String(input.decisionRationale ?? 'Decision rationale placeholder for owner/admin review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    followUpActions: (input.followUpActions ?? []).map((item) => String(item).slice(0, 220)),
    recordedByUserId: input.recordedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticComplianceClaims: false,
    automaticEnforcementActions: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceGovernanceDecisionRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(decisionInput) {
      const decision = normalizeComplianceGovernanceDecision(decisionInput)
      if (!database?.connected) return { ok: true, disabled: true, decision }
      const result = await database.query(
        `INSERT INTO atlas_compliance_governance_decisions
          (id, organization_id, team_workspace_id, decision_status, decision_type, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET decision_status = EXCLUDED.decision_status, decision_type = EXCLUDED.decision_type, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [
          decision.id,
          decision.tenantScope.organizationId,
          decision.tenantScope.teamWorkspaceId,
          decision.decisionStatus,
          decision.decisionType,
          decision,
        ],
      )
      return { ok: true, decision: normalizeComplianceGovernanceDecision(result.rows?.[0]?.payload ?? decision) }
    },
    async list({ tenantContext = {}, decisionStatus, decisionType, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (decisionStatus) {
        params.push(safeStatus(decisionStatus))
        clauses.push(`decision_status = $${params.length}`)
      }
      if (decisionType) {
        params.push(safeType(decisionType))
        clauses.push(`decision_type = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_governance_decisions
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceGovernanceDecision(row.payload))
    },
  }
}

export function recordComplianceGovernanceDecisions(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceGovernanceDecisions ?? []
  const auditReadiness = input.complianceAuditReadinessPackage ?? {}
  const externalReview = input.complianceExternalReviewPlanning ?? {}
  const readout = input.complianceGovernanceReadout ?? {}
  const needsReview = auditReadiness.auditReadinessStatus === 'caution' || externalReview.externalReviewStatus === 'caution' || readout.readoutStatus === 'blocked'
  const decisions = (supplied.length ? supplied : [normalizeComplianceGovernanceDecision({
    tenantContext,
    decisionType: 'audit-readiness',
    decisionStatus: needsReview ? 'needs_review' : 'draft',
    decisionSummary: `Governance decision log references ${auditReadiness.auditReadinessSummary?.readyForReview ?? 0} audit readiness packages and ${externalReview.externalReviewSummary?.readyForReview ?? 0} external review plans ready for owner/admin review.`,
    decisionRationale: 'Decision remains human-reviewed and does not approve, submit, distribute, attest, or enforce compliance outcomes automatically.',
    sourceReferences: [
      { id: 'compliance-audit-readiness', type: 'compliance-audit-readiness-package', eventType: auditReadiness.eventType },
      { id: 'compliance-external-review', type: 'compliance-external-review-planning', eventType: externalReview.eventType },
      { id: 'compliance-governance-readout', type: 'compliance-governance-readout', eventType: readout.eventType },
      { id: 'compliance-escalation-planning', type: 'compliance-escalation-planning', eventType: input.complianceEscalationPlanning?.eventType },
    ],
    followUpActions: ['Review audit readiness package', 'Review external review plan', 'Record owner/admin decision when ready'],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceGovernanceDecision)
  const decisionSummary = {
    total: decisions.length,
    draft: decisions.filter((item) => item.decisionStatus === 'draft').length,
    recorded: decisions.filter((item) => item.decisionStatus === 'recorded').length,
    needsReview: decisions.filter((item) => item.decisionStatus === 'needs_review').length,
    superseded: decisions.filter((item) => item.decisionStatus === 'superseded').length,
  }
  const decisionLogStatus = decisionSummary.needsReview > 0 ? 'caution' : decisionSummary.recorded > 0 || decisionSummary.draft > 0 ? 'ready' : 'caution'
  const result = {
    eventType: SYSTEM_COMPLIANCE_GOVERNANCE_DECISION_RECORDED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceGovernanceDecisions: decisions,
    decisionSummary,
    decisionLogStatus,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticComplianceClaims: false,
    automaticEnforcementActions: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance governance decision log ${decisionLogStatus}: ${decisionSummary.draft} draft, ${decisionSummary.recorded} recorded, and ${decisionSummary.needsReview} needing review.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_GOVERNANCE_DECISION_RECORDED_EVENT, result)
  return result
}
