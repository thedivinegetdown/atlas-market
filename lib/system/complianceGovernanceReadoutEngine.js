import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_GOVERNANCE_READOUT_PREPARED_EVENT = 'system.complianceGovernanceReadout.prepared'

export const READOUT_STATUSES = Object.freeze(['draft', 'ready_for_review', 'needs_updates', 'reviewed'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return READOUT_STATUSES.includes(status) ? status : 'draft'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceGovernanceReadout(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-governance-readout-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    readoutStatus: safeStatus(input.readoutStatus ?? input.status),
    readoutAudience: input.readoutAudience ?? 'owner-admin-review',
    readoutSummary: String(input.readoutSummary ?? 'Compliance governance readout prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    keyRisks: (input.keyRisks ?? []).map((item) => String(item).slice(0, 220)),
    recommendedReviewActions: (input.recommendedReviewActions ?? []).map((item) => String(item).slice(0, 220)),
    preparedByUserId: input.preparedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    automaticDistribution: false,
    automaticEnforcementActions: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceGovernanceReadoutRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(readoutInput) {
      const readout = normalizeComplianceGovernanceReadout(readoutInput)
      if (!database?.connected) return { ok: true, disabled: true, readout }
      const result = await database.query(
        `INSERT INTO atlas_compliance_governance_readouts
          (id, organization_id, team_workspace_id, readout_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET readout_status = EXCLUDED.readout_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [readout.id, readout.tenantScope.organizationId, readout.tenantScope.teamWorkspaceId, readout.readoutStatus, readout],
      )
      return { ok: true, readout: normalizeComplianceGovernanceReadout(result.rows?.[0]?.payload ?? readout) }
    },
    async list({ tenantContext = {}, readoutStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (readoutStatus) {
        params.push(safeStatus(readoutStatus))
        clauses.push(`readout_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_governance_readouts
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceGovernanceReadout(row.payload))
    },
  }
}

export function prepareComplianceGovernanceReadout(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceGovernanceReadouts ?? []
  const risk = input.complianceRiskCommandCenter ?? {}
  const calendar = input.complianceReviewCalendar ?? {}
  const renewals = input.complianceAttestationRenewalPlanning ?? {}
  const escalations = input.complianceEscalationPlanning ?? {}
  const readouts = (supplied.length ? supplied : [normalizeComplianceGovernanceReadout({
    tenantContext,
    readoutStatus: risk.commandCenterStatus === 'blocked' ? 'needs_updates' : 'ready_for_review',
    readoutSummary: `Compliance governance readout summarizes ${risk.openFindings ?? 0} open findings, ${risk.slaBreaches ?? 0} SLA breaches, and ${renewals.renewalSummary?.dueSoon ?? 0} attestation renewals due soon.`,
    sourceReferences: [
      { id: 'compliance-risk-command', type: 'compliance-risk-command-center', eventType: risk.eventType },
      { id: 'compliance-review-calendar', type: 'compliance-review-calendar', eventType: calendar.eventType },
      { id: 'compliance-attestation-renewal', type: 'compliance-attestation-renewal', eventType: renewals.eventType },
      { id: 'compliance-escalation-planning', type: 'compliance-escalation-planning', eventType: escalations.eventType },
    ],
    keyRisks: [
      `${risk.slaBreaches ?? 0} SLA breaches`,
      `${risk.criticalFindings ?? 0} critical findings`,
      `${renewals.renewalSummary?.overdue ?? 0} overdue attestation renewals`,
    ],
    recommendedReviewActions: ['Review due and overdue calendar items', 'Review planned escalations', 'Review attestation renewal queue'],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceGovernanceReadout)
  const readoutSummary = {
    total: readouts.length,
    readyForReview: readouts.filter((item) => item.readoutStatus === 'ready_for_review').length,
    needsUpdates: readouts.filter((item) => item.readoutStatus === 'needs_updates').length,
    reviewed: readouts.filter((item) => item.readoutStatus === 'reviewed').length,
  }
  const readoutStatus = readoutSummary.needsUpdates > 0 ? 'blocked' : readoutSummary.readyForReview > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_GOVERNANCE_READOUT_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceGovernanceReadouts: readouts,
    readoutSummary,
    readoutStatus,
    humanReviewOnly: true,
    automaticComplianceClaims: false,
    automaticApproval: false,
    automaticDistribution: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance governance readout ${readoutStatus}: ${readoutSummary.readyForReview} ready for review and ${readoutSummary.needsUpdates} needing updates.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_GOVERNANCE_READOUT_PREPARED_EVENT, result)
  return result
}
