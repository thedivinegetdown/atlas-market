import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_ATTESTATION_RENEWAL_PLANNED_EVENT = 'system.complianceAttestationRenewal.planned'

export const RENEWAL_STATUSES = Object.freeze(['planned', 'due_soon', 'overdue', 'completed', 'deferred'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return RENEWAL_STATUSES.includes(status) ? status : 'planned'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function daysUntil(dueDate, now) {
  if (!dueDate) return 30
  const due = new Date(dueDate)
  const current = new Date(now)
  if (Number.isNaN(due.getTime()) || Number.isNaN(current.getTime())) return 30
  return Math.ceil((due.getTime() - current.getTime()) / 86_400_000)
}

function statusFromDueDate(dueDate, now) {
  const remaining = daysUntil(dueDate, now)
  if (remaining < 0) return 'overdue'
  if (remaining <= 14) return 'due_soon'
  return 'planned'
}

export function normalizeComplianceAttestationRenewal(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-attestation-renewal-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    renewalStatus: safeStatus(input.renewalStatus ?? input.status),
    renewalPriority: input.renewalPriority ?? 'medium',
    dueDate: input.dueDate ?? null,
    policyReferences: (input.policyReferences ?? []).map(normalizeReference),
    attestationReferences: (input.attestationReferences ?? []).map(normalizeReference),
    obligationReferences: (input.obligationReferences ?? []).map(normalizeReference),
    calendarReferences: (input.calendarReferences ?? []).map(normalizeReference),
    assignedRole: input.assignedRole ?? 'admin',
    summary: String(input.summary ?? 'Policy attestation renewal planned for human review.').slice(0, 500),
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticAttestation: false,
    automaticRenewal: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createComplianceAttestationRenewalRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(renewalInput) {
      const renewal = normalizeComplianceAttestationRenewal(renewalInput)
      if (!database?.connected) return { ok: true, disabled: true, renewal }
      const result = await database.query(
        `INSERT INTO atlas_compliance_attestation_renewals
          (id, organization_id, team_workspace_id, renewal_status, renewal_priority, due_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET renewal_status = EXCLUDED.renewal_status, renewal_priority = EXCLUDED.renewal_priority, due_date = EXCLUDED.due_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [renewal.id, renewal.tenantScope.organizationId, renewal.tenantScope.teamWorkspaceId, renewal.renewalStatus, renewal.renewalPriority, renewal.dueDate, renewal],
      )
      return { ok: true, renewal: normalizeComplianceAttestationRenewal(result.rows?.[0]?.payload ?? renewal) }
    },
    async list({ tenantContext = {}, renewalStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (renewalStatus) {
        params.push(safeStatus(renewalStatus))
        clauses.push(`renewal_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_attestation_renewals
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY due_date ASC NULLS LAST, updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceAttestationRenewal(row.payload))
    },
  }
}

export function planComplianceAttestationRenewals(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const attestations = input.policyAttestation?.policyAttestations ?? []
  const obligations = input.complianceObligationMapping?.complianceObligations ?? []
  const calendarItems = input.complianceReviewCalendar?.complianceReviewCalendarItems ?? []
  const supplied = input.complianceAttestationRenewals ?? []
  const generated = attestations.filter((item) => ['pending', 'expired'].includes(item.attestationStatus) || daysUntil(item.expiresAt, now) <= 30).map((attestation) => {
    const renewalStatus = attestation.attestationStatus === 'expired' ? 'overdue' : statusFromDueDate(attestation.expiresAt, now)
    return normalizeComplianceAttestationRenewal({
      tenantContext,
      id: `compliance-attestation-renewal-${attestation.id}`,
      renewalStatus,
      renewalPriority: renewalStatus === 'overdue' ? 'high' : 'medium',
      dueDate: attestation.expiresAt,
      attestationReferences: [{ id: attestation.id, type: 'policy-attestation', eventType: input.policyAttestation?.eventType }],
      policyReferences: attestation.policyId ? [{ id: attestation.policyId, type: 'administrative-policy' }] : [],
      obligationReferences: obligations.slice(0, 3).map((item) => ({ id: item.id, type: 'compliance-obligation', eventType: input.complianceObligationMapping?.eventType })),
      calendarReferences: calendarItems.slice(0, 3).map((item) => ({ id: item.id, type: 'compliance-review-calendar', eventType: input.complianceReviewCalendar?.eventType })),
      summary: 'Attestation renewal planned for owner/admin review.',
      timestamp: now,
    })
  })
  const renewals = (supplied.length ? supplied : generated).map(normalizeComplianceAttestationRenewal)
  const renewalSummary = {
    total: renewals.length,
    planned: renewals.filter((item) => item.renewalStatus === 'planned').length,
    dueSoon: renewals.filter((item) => item.renewalStatus === 'due_soon').length,
    overdue: renewals.filter((item) => item.renewalStatus === 'overdue').length,
    completed: renewals.filter((item) => item.renewalStatus === 'completed').length,
  }
  const renewalStatus = renewalSummary.overdue > 0 ? 'blocked' : renewalSummary.dueSoon > 0 || renewalSummary.planned > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_COMPLIANCE_ATTESTATION_RENEWAL_PLANNED_EVENT,
    timestamp: now,
    complianceAttestationRenewals: renewals,
    renewalSummary,
    renewalStatus,
    humanReviewOnly: true,
    automaticAttestation: false,
    automaticRenewal: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance attestation renewal planning ${renewalStatus}: ${renewalSummary.dueSoon} due soon and ${renewalSummary.overdue} overdue.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_ATTESTATION_RENEWAL_PLANNED_EVENT, result)
  return result
}
