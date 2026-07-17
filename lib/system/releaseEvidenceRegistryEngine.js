import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RELEASE_EVIDENCE_EVENTS = Object.freeze({
  registered: 'releaseEvidence.registered',
  verified: 'releaseEvidence.verified',
  rejected: 'releaseEvidence.rejected',
  expired: 'releaseEvidence.expired',
  superseded: 'releaseEvidence.superseded',
})

export const REQUIRED_RELEASE_EVIDENCE_CATEGORIES = Object.freeze([
  'functional-test-results',
  'regression-test-results',
  'lint-results',
  'build-results',
  'migration-verification',
  'tenant-isolation-verification',
  'paper-only-boundary-verification',
  'production-configuration-validation',
  'production-run-validation',
  'recovery-readiness-validation',
])

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function tenantScope(input = {}) {
  const tenant = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenant.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenant.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenant.userId ?? input.userId ?? null,
    role: tenant.role ?? input.role ?? null,
  }
}

function sanitize(value, max = 400) {
  return String(value ?? '')
    .replace(/token|secret|password|credential|https?:\/\/\S+/gi, 'redacted')
    .slice(0, max)
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((next, key) => {
      if (!['stack', 'secret', 'token', 'password', 'credential', 'privateUrl', 'storagePath', 'rawConfiguration'].includes(String(key))) next[key] = stable(value[key])
      return next
    }, {})
  }
  return value
}

export function releaseEvidenceChecksum(value) {
  const text = JSON.stringify(stable(value))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

export function createReleaseEvidenceFingerprint(input = {}) {
  const scope = tenantScope(input)
  return releaseEvidenceChecksum({
    organizationId: scope.organizationId,
    teamWorkspaceId: scope.teamWorkspaceId,
    accountId: input.accountId ?? 'paper-portfolio',
    releaseCandidateId: input.releaseCandidateId ?? input.releaseCandidateManifest?.releaseCandidateId ?? null,
    category: input.category,
    sourceType: input.sourceType,
    sourceReference: input.sourceReference,
  })
}

function isExpired(expiresAt, timestamp) {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= new Date(timestamp).getTime()
}

function sourceMatchesTenant(input = {}) {
  const scope = tenantScope(input)
  const sourceTenant = input.sourceTenantScope ?? input.sourceRecord?.tenantScope
  if (!sourceTenant) return true
  return sourceTenant.organizationId === scope.organizationId
    && (sourceTenant.teamWorkspaceId ?? null) === (scope.teamWorkspaceId ?? null)
}

function sourceMatchesRelease(input = {}) {
  const releaseCandidateId = input.releaseCandidateId ?? input.releaseCandidateManifest?.releaseCandidateId ?? null
  const sourceReleaseCandidateId = input.sourceReleaseCandidateId ?? input.sourceRecord?.releaseCandidateId
  return !sourceReleaseCandidateId || !releaseCandidateId || sourceReleaseCandidateId === releaseCandidateId
}

export function registerReleaseEvidence(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const fingerprint = input.fingerprint ?? createReleaseEvidenceFingerprint(input)
  const duplicate = (input.existingEvidence ?? []).find((item) => item.fingerprint === fingerprint && ['pending', 'verified'].includes(item.verificationState))
  if (duplicate && !input.supersedesEvidenceId) {
    return {
      eventType: RELEASE_EVIDENCE_EVENTS.registered,
      timestamp,
      releaseEvidence: duplicate,
      duplicateSuppressed: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }
  let verificationState = input.verificationState ?? 'pending'
  let blockedReason = null
  if (!sourceMatchesTenant(input)) {
    verificationState = 'rejected'
    blockedReason = 'cross_tenant_reference'
  } else if (!sourceMatchesRelease(input)) {
    verificationState = 'rejected'
    blockedReason = 'cross_release_reference'
  } else if (isExpired(input.expiresAt, timestamp)) {
    verificationState = 'expired'
    blockedReason = 'evidence_expired'
  }
  const evidence = {
    id: String(input.id ?? `release-evidence-${fingerprint}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? input.releaseCandidateManifest?.accountId ?? 'paper-portfolio',
    releaseCandidateId: input.releaseCandidateId ?? input.releaseCandidateManifest?.releaseCandidateId ?? null,
    certificationId: input.certificationId ?? input.releaseCertification?.id ?? null,
    runbookId: input.runbookId ?? input.releaseRunbook?.id ?? null,
    approvalId: input.approvalId ?? input.releaseApproval?.id ?? null,
    productionRunValidationId: input.productionRunValidationId ?? input.productionRunValidation?.id ?? null,
    category: String(input.category ?? 'manual-qa-evidence').slice(0, 120),
    sourceType: String(input.sourceType ?? 'manual-metadata').slice(0, 80),
    sourceReference: sanitize(input.sourceReference ?? input.sourceRecord?.id ?? 'manual-reference', 220),
    title: sanitize(input.title ?? input.category ?? 'Release evidence', 180),
    sanitizedDescription: sanitize(input.description ?? input.sanitizedDescription ?? ''),
    checksum: input.checksum ?? null,
    fingerprint,
    verificationState,
    verifiedBy: input.verifiedBy ?? null,
    verifiedRole: input.verifiedRole ?? null,
    verifiedAt: input.verifiedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    supersedesEvidenceId: input.supersedesEvidenceId ?? null,
    supersedingEvidenceId: input.supersedingEvidenceId ?? null,
    blockedReason,
    createdAt: timestamp,
    updatedAt: timestamp,
    immutable: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  const activity = evidenceActivity({ evidence, actor: input.actor, action: verificationState, timestamp })
  const eventType = verificationState === 'verified' ? RELEASE_EVIDENCE_EVENTS.verified : verificationState === 'rejected' ? RELEASE_EVIDENCE_EVENTS.rejected : verificationState === 'expired' ? RELEASE_EVIDENCE_EVENTS.expired : RELEASE_EVIDENCE_EVENTS.registered
  const result = {
    eventType,
    timestamp,
    releaseEvidence: evidence,
    releaseEvidenceActivity: activity,
    duplicateSuppressed: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(eventType, result)
  return result
}

function evidenceActivity({ evidence, actor = {}, action, note = '', timestamp }) {
  return {
    id: `${evidence.id}-activity-${action}-${Date.parse(timestamp) || Date.now()}`,
    tenantScope: evidence.tenantScope,
    accountId: evidence.accountId,
    releaseCandidateId: evidence.releaseCandidateId,
    evidenceId: evidence.id,
    actor: {
      id: actor.id ?? evidence.tenantScope.userId ?? evidence.verifiedBy ?? 'unknown-actor',
      role: actor.role ?? evidence.tenantScope.role ?? evidence.verifiedRole ?? 'viewer',
    },
    action,
    sanitizedNote: sanitize(note),
    createdAt: timestamp,
    appendOnly: true,
  }
}

export function updateReleaseEvidenceVerification(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const evidence = input.releaseEvidence ?? input.evidence ?? {}
  const actor = input.actor ?? { id: input.tenantContext?.userId ?? 'unknown-actor', role: input.tenantContext?.role ?? 'viewer' }
  const action = input.action ?? input.verificationState ?? 'verified'
  const rolePermitted = ['owner', 'admin', 'analyst'].includes(actor.role)
  const requestedState = action === 'reject' ? 'rejected' : action === 'expire' ? 'expired' : action === 'supersede' ? 'superseded' : action
  const terminal = ['expired', 'superseded'].includes(evidence.verificationState) || (evidence.verificationState === 'verified' && requestedState === 'verified')
  const verificationState = !rolePermitted ? 'rejected' : isExpired(evidence.expiresAt, timestamp) ? 'expired' : ['verified', 'rejected', 'expired', 'superseded'].includes(requestedState) ? requestedState : 'rejected'
  const updated = {
    ...evidence,
    verificationState: terminal ? evidence.verificationState : verificationState,
    verifiedBy: verificationState === 'verified' ? actor.id : evidence.verifiedBy ?? null,
    verifiedRole: verificationState === 'verified' ? actor.role : evidence.verifiedRole ?? null,
    verifiedAt: verificationState === 'verified' ? timestamp : evidence.verifiedAt ?? null,
    blockedReason: rolePermitted ? (verificationState === 'rejected' ? (input.reason ? null : 'evidence_rejected') : null) : 'role_not_permitted',
    updatedAt: timestamp,
  }
  const eventType = updated.verificationState === 'verified' ? RELEASE_EVIDENCE_EVENTS.verified : updated.verificationState === 'expired' ? RELEASE_EVIDENCE_EVENTS.expired : updated.verificationState === 'superseded' ? RELEASE_EVIDENCE_EVENTS.superseded : RELEASE_EVIDENCE_EVENTS.rejected
  return {
    eventType,
    timestamp,
    releaseEvidence: updated,
    releaseEvidenceActivity: evidenceActivity({ evidence: updated, actor, action: updated.verificationState, note: input.reason ?? input.note, timestamp }),
    validTransition: rolePermitted && !terminal,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function supersedeReleaseEvidence(input = {}, options = {}) {
  const current = input.releaseEvidence ?? input.evidence ?? {}
  const registered = registerReleaseEvidence({
    ...current,
    ...input,
    id: input.id,
    sourceReference: input.sourceReference ?? current.sourceReference,
    supersedesEvidenceId: current.id,
    verificationState: input.verificationState ?? 'pending',
    existingEvidence: [],
  }, { ...options, emitEvent: false })
  const result = {
    ...registered,
    eventType: RELEASE_EVIDENCE_EVENTS.superseded,
    supersededEvidenceId: current.id,
    releaseEvidence: {
      ...registered.releaseEvidence,
      supersedesEvidenceId: current.id,
    },
  }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(RELEASE_EVIDENCE_EVENTS.superseded, result)
  return result
}

export function summarizeReleaseEvidence(evidence = [], requiredCategories = REQUIRED_RELEASE_EVIDENCE_CATEGORIES, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const current = evidence.map((item) => isExpired(item.expiresAt, timestamp) && item.verificationState !== 'superseded' ? { ...item, verificationState: 'expired' } : item)
  const satisfying = current.filter((item) => item.verificationState === 'verified' && !isExpired(item.expiresAt, timestamp))
  const satisfiedCategories = new Set(satisfying.map((item) => item.category))
  const missingCategories = requiredCategories.filter((category) => !satisfiedCategories.has(category))
  return {
    requiredCategories,
    missingCategories,
    verifiedCount: satisfying.length,
    pendingCount: current.filter((item) => item.verificationState === 'pending').length,
    rejectedCount: current.filter((item) => item.verificationState === 'rejected').length,
    expiredCount: current.filter((item) => item.verificationState === 'expired').length,
    supersededCount: current.filter((item) => item.verificationState === 'superseded').length,
    satisfiesRequiredEvidence: missingCategories.length === 0,
    currentEvidence: satisfying,
  }
}

export function createReleaseEvidenceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const evidence = input.releaseEvidence ?? input
      if (!database?.connected) return { ok: true, disabled: true, evidence }
      const result = await database.query(
        `INSERT INTO atlas_release_evidence
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, certification_id, runbook_id, approval_id, production_run_validation_id, category, source_type, verification_state, fingerprint, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [evidence.id, evidence.tenantScope.organizationId, evidence.tenantScope.teamWorkspaceId, evidence.accountId, evidence.releaseCandidateId, evidence.certificationId, evidence.runbookId, evidence.approvalId, evidence.productionRunValidationId, evidence.category, evidence.sourceType, evidence.verificationState, evidence.fingerprint, evidence],
      )
      return { ok: true, evidence: result.rows?.[0]?.payload ?? evidence, immutable: true }
    },
    async appendActivity(input) {
      const activity = input.releaseEvidenceActivity ?? input
      if (!database?.connected) return { ok: true, disabled: true, activity }
      await database.query(
        `INSERT INTO atlas_release_evidence_activity
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, evidence_id, actor_id, action, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [activity.id, activity.tenantScope.organizationId, activity.tenantScope.teamWorkspaceId, activity.accountId, activity.releaseCandidateId, activity.evidenceId, activity.actor.id, activity.action, activity],
      )
      return { ok: true, activity }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, verificationState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (verificationState) { params.push(String(verificationState)); clauses.push(`verification_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_evidence
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
