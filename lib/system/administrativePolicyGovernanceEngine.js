import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ADMINISTRATIVE_POLICY_EVALUATED_EVENT = 'system.administrativePolicy.evaluated'
export const SYSTEM_ADMINISTRATIVE_POLICY_UPDATED_EVENT = 'system.administrativePolicy.updated'

export const POLICY_DOMAINS = Object.freeze([
  'access governance',
  'membership administration',
  'invitation administration',
  'session security',
  'notification governance',
  'administrative case management',
  'evidence governance',
  'remediation planning',
  'remediation effectiveness',
  'workflow SLA management',
  'access certification',
  'tenant health operations',
  'audit completeness',
  'data retention review',
])
export const POLICY_STATUSES = Object.freeze(['draft', 'active', 'under_review', 'superseded', 'retired'])
export const ENFORCEMENT_MODES = Object.freeze(['advisory', 'review_required', 'approval_required'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function addDays(isoDate, days) {
  const date = new Date(isoDate)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function safeDomain(domain) {
  return POLICY_DOMAINS.includes(domain) ? domain : 'audit completeness'
}

function safeStatus(status) {
  return POLICY_STATUSES.includes(status) ? status : 'draft'
}

function safeMode(mode) {
  return ENFORCEMENT_MODES.includes(mode) ? mode : 'advisory'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.policyId ?? reference.evidenceId ?? null,
    type: reference.type ?? reference.evidenceType ?? 'reference',
    eventType: reference.eventType ?? reference.sourceEventReference?.eventType ?? null,
  }
}

function policyId(domain, tenantScope = {}) {
  return `policy-${String(tenantScope.organizationId ?? 'tenant').replace(/[^A-Za-z0-9._:-]/g, '-')}-${String(domain).replace(/[^A-Za-z0-9._:-]/g, '-')}`
}

export function normalizeAdministrativePolicy(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const domain = safeDomain(input.policyDomain ?? input.domain)
  const status = safeStatus(input.policyStatus ?? input.status)
  const reviewDate = input.reviewDate ?? addDays(input.effectiveDate ?? now, status === 'active' ? 180 : 30)
  return {
    id: String(input.id ?? input.policyId ?? policyId(domain, tenantScope)),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    policyDomain: domain,
    policyName: String(input.policyName ?? `${domain} policy`).slice(0, 160),
    policyVersion: String(input.policyVersion ?? 'v1').slice(0, 40),
    policyStatus: status,
    effectiveDate: input.effectiveDate ?? now,
    reviewDate,
    policyOwnerUserId: input.policyOwnerUserId ?? tenantScope.userId ?? null,
    approverUserId: input.approverUserId ?? null,
    controlReferences: (input.controlReferences ?? []).map(normalizeReference),
    requiredEvidenceReferences: (input.requiredEvidenceReferences ?? []).map(normalizeReference),
    enforcementMode: safeMode(input.enforcementMode),
    exceptionState: input.exceptionState ?? 'none',
    humanReviewRequirements: (input.humanReviewRequirements ?? ['owner/admin review before action']).map((item) => String(item).slice(0, 160)),
    auditReferences: (input.auditReferences ?? []).map(normalizeReference),
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    automaticEnforcement: false,
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    sensitiveMaterialExcluded: true,
  }
}

export function createAdministrativePolicyRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(policyInput) {
      const policy = normalizeAdministrativePolicy(policyInput)
      if (!database?.connected) return { ok: true, disabled: true, policy }
      const result = await database.query(
        `INSERT INTO atlas_administrative_policies
          (id, organization_id, team_workspace_id, policy_domain, policy_status, review_date, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET policy_status = EXCLUDED.policy_status, review_date = EXCLUDED.review_date, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [policy.id, policy.tenantScope.organizationId, policy.tenantScope.teamWorkspaceId, policy.policyDomain, policy.policyStatus, policy.reviewDate, policy],
      )
      return { ok: true, policy: normalizeAdministrativePolicy(result.rows?.[0]?.payload ?? policy) }
    },
    async list({ tenantContext = {}, policyStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (policyStatus) {
        params.push(safeStatus(policyStatus))
        clauses.push(`policy_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_administrative_policies
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAdministrativePolicy(row.payload))
    },
    async get({ id, tenantContext = {} }) {
      if (!database?.connected) return null
      const result = await database.query(
        `SELECT payload FROM atlas_administrative_policies
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? ''],
      )
      return result.rows?.[0]?.payload ? normalizeAdministrativePolicy(result.rows[0].payload) : null
    },
    async updateStatus({ id, tenantContext = {}, policyStatus }) {
      const status = safeStatus(policyStatus)
      if (!database?.connected) return { ok: true, disabled: true, policy: normalizeAdministrativePolicy({ id, tenantContext, policyStatus: status }) }
      const result = await database.query(
        `UPDATE atlas_administrative_policies
         SET policy_status = $4,
             payload = jsonb_set(payload, '{policyStatus}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND COALESCE(team_workspace_id, '') = COALESCE($3, '')
         RETURNING payload`,
        [id, tenantContext.organizationId, tenantContext.teamWorkspaceId ?? '', status],
      )
      return { ok: result.rows?.length > 0, policy: result.rows?.[0]?.payload ? normalizeAdministrativePolicy(result.rows[0].payload) : null }
    },
  }
}

export function evaluateAdministrativePolicyGovernance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? input.tenantScope ?? {}
  const policies = input.policies?.length
    ? input.policies.map(normalizeAdministrativePolicy)
    : POLICY_DOMAINS.map((domain) => normalizeAdministrativePolicy({
      tenantContext,
      policyDomain: domain,
      policyStatus: ['evidence governance', 'remediation effectiveness', 'audit completeness'].includes(domain) ? 'under_review' : 'active',
      enforcementMode: ['session security', 'access certification'].includes(domain) ? 'approval_required' : 'review_required',
      requiredEvidenceReferences: [
        { id: `${domain}-evidence`, type: 'normalized-output', eventType: input.sourceEvents?.[domain] ?? null },
      ],
      controlReferences: [{ id: `control-${domain.replace(/\s+/g, '-')}`, type: 'policy-control' }],
      timestamp: now,
    }))
  const policyEvaluations = policies.map((policy) => ({
    policy,
    reviewPastDue: new Date(policy.reviewDate).getTime() <= new Date(now).getTime(),
    alignmentStatus: policy.policyStatus === 'active' && policy.requiredEvidenceReferences.length > 0 ? 'aligned' : 'review_required',
    humanReviewRequired: policy.policyStatus !== 'active' || policy.enforcementMode !== 'advisory',
  }))
  const policySummary = {
    total: policies.length,
    active: policies.filter((policy) => policy.policyStatus === 'active').length,
    underReview: policies.filter((policy) => policy.policyStatus === 'under_review').length,
    pastReviewDate: policyEvaluations.filter((item) => item.reviewPastDue).length,
    approvalRequired: policies.filter((policy) => policy.enforcementMode === 'approval_required').length,
    exceptions: policies.filter((policy) => policy.exceptionState !== 'none').length,
  }
  const policyGovernanceStatus = policySummary.pastReviewDate > 0 ? 'blocked' : policySummary.underReview > 0 || policySummary.exceptions > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_POLICY_EVALUATED_EVENT,
    timestamp: now,
    administrativePolicies: policies,
    policyEvaluations,
    policySummary,
    policyGovernanceStatus,
    automaticEnforcement: false,
    humanReviewOnly: true,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Administrative policy governance ${policyGovernanceStatus}: ${policySummary.active} active policies and ${policySummary.underReview} under review.`,
    sourceEvents: {
      administrativeGovernanceCommandCenter: input.administrativeGovernanceCommandCenter?.eventType ?? null,
      evidenceGovernance: input.evidenceGovernance?.eventType ?? null,
      remediationEffectiveness: input.remediationEffectiveness?.eventType ?? null,
      accessReview: input.accessReview?.eventType ?? null,
      accessCertification: input.accessCertification?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ADMINISTRATIVE_POLICY_EVALUATED_EVENT, result)
  return result
}

export async function updateAdministrativePolicyStatus(input = {}, options = {}) {
  const repository = options.repository ?? createAdministrativePolicyRepository(options)
  const response = await repository.updateStatus(input)
  const result = {
    eventType: SYSTEM_ADMINISTRATIVE_POLICY_UPDATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    policy: response.policy,
    requestedPolicyStatus: safeStatus(input.policyStatus),
    status: response.ok ? 'updated' : 'blocked',
    automaticEnforcement: false,
    humanReviewOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (options.emitEvent !== false && (options.eventBus ?? defaultEventBus)?.emit) (options.eventBus ?? defaultEventBus).emit(SYSTEM_ADMINISTRATIVE_POLICY_UPDATED_EVENT, result)
  return result
}
