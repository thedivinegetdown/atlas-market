import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_POLICY_ATTESTATION_RECORDED_EVENT = 'system.policyAttestation.recorded'
export const SYSTEM_POLICY_ATTESTATION_EVALUATED_EVENT = 'system.policyAttestation.evaluated'

export const ATTESTATION_STATUSES = Object.freeze(['pending', 'attested', 'exceptions_noted', 'rejected', 'expired'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function addDays(isoDate, days) {
  const date = new Date(isoDate)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function safeStatus(status) {
  return ATTESTATION_STATUSES.includes(status) ? status : 'pending'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.policyId ?? reference.controlId ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

export function normalizePolicyAttestation(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `policy-attestation-${input.policyId ?? Date.now()}`),
    policyId: input.policyId ?? null,
    controlId: input.controlId ?? null,
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    attestationStatus: safeStatus(input.attestationStatus ?? input.status),
    attestedByUserId: input.attestedByUserId ?? tenantScope.userId ?? null,
    attestationScope: String(input.attestationScope ?? 'administrative policy and control assurance').slice(0, 220),
    attestationSummary: String(input.attestationSummary ?? 'Human-reviewed policy attestation placeholder.').slice(0, 500),
    exceptionReferences: (input.exceptionReferences ?? []).map(normalizeReference),
    evidenceReferences: (input.evidenceReferences ?? []).map(normalizeReference),
    expiresAt: input.expiresAt ?? addDays(now, 90),
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticEnforcement: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createPolicyAttestationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(attestationInput) {
      const attestation = normalizePolicyAttestation(attestationInput)
      if (!database?.connected) return { ok: true, disabled: true, attestation }
      const result = await database.query(
        `INSERT INTO atlas_policy_attestations
          (id, organization_id, team_workspace_id, policy_id, control_id, attestation_status, expires_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET attestation_status = EXCLUDED.attestation_status, expires_at = EXCLUDED.expires_at, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [attestation.id, attestation.tenantScope.organizationId, attestation.tenantScope.teamWorkspaceId, attestation.policyId, attestation.controlId, attestation.attestationStatus, attestation.expiresAt, attestation],
      )
      return { ok: true, attestation: normalizePolicyAttestation(result.rows?.[0]?.payload ?? attestation) }
    },
    async list({ tenantContext = {}, attestationStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (attestationStatus) {
        params.push(safeStatus(attestationStatus))
        clauses.push(`attestation_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_policy_attestations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizePolicyAttestation(row.payload))
    },
  }
}

export function evaluatePolicyAttestations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const policies = input.policyGovernance?.administrativePolicies ?? []
  const exceptions = input.controlAssurance?.policyExceptions ?? []
  const supplied = input.policyAttestations ?? []
  const attestations = supplied.length
    ? supplied.map(normalizePolicyAttestation)
    : policies.slice(0, 6).map((policy) => normalizePolicyAttestation({
      tenantContext,
      policyId: policy.id,
      controlId: policy.controlReferences?.[0]?.id ?? null,
      attestationStatus: policy.policyStatus === 'active' ? 'pending' : 'exceptions_noted',
      exceptionReferences: exceptions.filter((exception) => exception.policyId === policy.id),
      evidenceReferences: policy.requiredEvidenceReferences,
      timestamp: now,
    }))
  const summary = {
    total: attestations.length,
    pending: attestations.filter((item) => item.attestationStatus === 'pending').length,
    attested: attestations.filter((item) => item.attestationStatus === 'attested').length,
    exceptionsNoted: attestations.filter((item) => item.attestationStatus === 'exceptions_noted').length,
    rejected: attestations.filter((item) => item.attestationStatus === 'rejected').length,
    expired: attestations.filter((item) => item.attestationStatus === 'expired' || new Date(item.expiresAt).getTime() <= new Date(now).getTime()).length,
  }
  const attestationStatus = summary.rejected > 0 || summary.expired > 0 ? 'blocked' : summary.pending > 0 || summary.exceptionsNoted > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_POLICY_ATTESTATION_EVALUATED_EVENT,
    timestamp: now,
    policyAttestations: attestations,
    attestationSummary: summary,
    attestationStatus,
    humanReviewOnly: true,
    automaticApproval: false,
    automaticEnforcement: false,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Policy attestations ${attestationStatus}: ${summary.pending} pending and ${summary.exceptionsNoted} with exceptions noted.`,
    sourceEvents: {
      policyGovernance: input.policyGovernance?.eventType ?? null,
      controlAssurance: input.controlAssurance?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_POLICY_ATTESTATION_EVALUATED_EVENT, result)
  return result
}
