import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { REQUIRED_RELEASE_EVIDENCE_CATEGORIES, summarizeReleaseEvidence } from './releaseEvidenceRegistryEngine.js'

export const RELEASE_ATTESTATION_EVENTS = Object.freeze({
  created: 'releaseAttestation.created',
  ready: 'releaseAttestation.ready',
  signed: 'releaseAttestation.signed',
  revoked: 'releaseAttestation.revoked',
  superseded: 'releaseAttestation.superseded',
})

export const RELEASE_GATE_EVENTS = Object.freeze({
  evaluated: 'releaseGate.evaluated',
  passed: 'releaseGate.passed',
  blocked: 'releaseGate.blocked',
})

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
      if (!['stack', 'secret', 'token', 'password', 'credential', 'privateUrl', 'storagePath', 'signatureSecret'].includes(String(key))) next[key] = stable(value[key])
      return next
    }, {})
  }
  return value
}

export function releaseAttestationChecksum(value) {
  const text = JSON.stringify(stable(value))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

function signChecksum(contentChecksum, signingSecret) {
  return `atlas-sig-${releaseAttestationChecksum({ contentChecksum, signingSecret })}`
}

function okWithWarnings(state, passState, warningState, acceptedWarnings) {
  return state === passState || (acceptedWarnings && state === warningState)
}

function evidenceSummary(input = {}) {
  return input.evidenceSummary ?? summarizeReleaseEvidence(input.releaseEvidence ?? input.evidence ?? [], input.requiredEvidenceCategories ?? REQUIRED_RELEASE_EVIDENCE_CATEGORIES, { timestamp: input.timestamp })
}

function gateCheck(id, label, passed, message, severity = 'critical') {
  return { id, label, status: passed ? 'passed' : 'blocked', severity: passed ? 'info' : severity, message }
}

function eligibility(input = {}) {
  const manifest = input.releaseCandidateManifest ?? {}
  const approval = input.releaseApproval ?? {}
  const productionRunValidation = input.productionRunValidation ?? {}
  const certification = input.releaseCertification ?? {}
  const recovery = input.releaseRecoveryReadiness ?? {}
  const summary = evidenceSummary(input)
  const acceptedWarnings = input.acceptedWarnings === true
  const checks = [
    gateCheck('candidate-approved', 'Release candidate approved', approval.approvalState === 'approved' && !['blocked', 'superseded'].includes(manifest.manifestState), 'Release candidate must be approved and active.'),
    gateCheck('production-run', 'Production-run validation', okWithWarnings(productionRunValidation.validationState, 'passed', 'warning', acceptedWarnings), 'Production-run validation must pass or have accepted warnings.'),
    gateCheck('qa-certification', 'QA certification', okWithWarnings(certification.certificationState, 'passed', 'warning', acceptedWarnings), 'QA certification must pass or have accepted warnings.'),
    gateCheck('recovery-readiness', 'Recovery readiness', okWithWarnings(recovery.recoveryReadinessState, 'ready', 'warning', acceptedWarnings), 'Recovery readiness must be ready or have accepted warnings.'),
    gateCheck('required-evidence', 'Required release evidence', summary.satisfiesRequiredEvidence, `Missing evidence: ${summary.missingCategories.join(', ') || 'none'}.`),
    gateCheck('paper-only', 'Paper-only declaration', manifest.liveOrders === false && manifest.brokerExecution === false, 'Release candidate must remain paper-trading only.'),
  ]
  const blockers = checks.filter((item) => item.status === 'blocked')
  return { checks, blockers, evidenceSummary: summary, eligible: blockers.length === 0 }
}

export function buildReleaseAttestationContent(input = {}) {
  const manifest = input.releaseCandidateManifest ?? {}
  const certification = input.releaseCertification ?? {}
  const recovery = input.releaseRecoveryReadiness ?? {}
  const productionRunValidation = input.productionRunValidation ?? {}
  const approval = input.releaseApproval ?? {}
  const summary = evidenceSummary(input)
  const actor = input.actor ?? {}
  return stable({
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    applicationVersion: manifest.applicationVersion ?? null,
    commit: manifest.gitCommit ?? null,
    branch: manifest.branch ?? null,
    migrationLevel: manifest.databaseMigrationLevel ?? null,
    manifestChecksum: manifest.checksum ?? null,
    certificationReference: certification.id ?? null,
    certificationState: certification.certificationState ?? null,
    recoveryReadinessReference: recovery.id ?? null,
    recoveryReadinessState: recovery.recoveryReadinessState ?? null,
    productionRunValidationReference: productionRunValidation.id ?? null,
    productionRunValidationState: productionRunValidation.validationState ?? null,
    approvalReference: approval.id ?? null,
    requiredEvidenceSummary: {
      requiredCategories: summary.requiredCategories,
      missingCategories: summary.missingCategories,
      verifiedCount: summary.verifiedCount,
    },
    knownWarnings: (input.knownWarnings ?? manifest.knownWarnings ?? []).map((item) => sanitize(item.message ?? item.label ?? item, 180)),
    acceptedRisks: (input.acceptedRisks ?? []).map((item) => sanitize(item.message ?? item, 180)),
    paperOnlyDeclaration: 'Atlas Market v1.0 release readiness is limited to the paper-trading platform. No live orders or broker execution are included.',
    signerIdentityReference: actor.id ?? input.signerId ?? null,
    signerRole: actor.role ?? input.signerRole ?? null,
    signedTimestamp: input.signedAt ?? null,
  })
}

export function createReleaseAttestation(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const eligibilityResult = eligibility({ ...input, timestamp })
  const content = buildReleaseAttestationContent(input)
  const checksum = releaseAttestationChecksum(content)
  const state = input.attestationState ?? (eligibilityResult.eligible ? 'ready' : 'draft')
  const attestation = {
    id: String(input.id ?? `release-attestation-${manifest.releaseCandidateId ?? 'rc'}-${checksum}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    approvalId: input.releaseApproval?.id ?? input.approvalId ?? null,
    certificationId: input.releaseCertification?.id ?? input.certificationId ?? null,
    runbookId: input.releaseRunbook?.id ?? input.runbookId ?? null,
    productionRunValidationId: input.productionRunValidation?.id ?? input.productionRunValidationId ?? null,
    attestationState: state,
    attestationContent: content,
    attestationChecksum: checksum,
    signature: null,
    signatureIntegrity: 'unsigned',
    signer: input.actor ?? null,
    signedAt: null,
    revokedAt: null,
    supersedesAttestationId: input.supersedesAttestationId ?? null,
    blockers: eligibilityResult.blockers,
    warnings: eligibilityResult.checks.filter((item) => item.severity === 'warning'),
    evidenceSummary: eligibilityResult.evidenceSummary,
    createdAt: timestamp,
    updatedAt: timestamp,
    immutableContent: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const eventType = state === 'ready' ? RELEASE_ATTESTATION_EVENTS.ready : RELEASE_ATTESTATION_EVENTS.created
  const result = {
    eventType,
    timestamp,
    releaseAttestation: attestation,
    attestationState: state,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(eventType, result)
  return result
}

export function signReleaseAttestation(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const actor = input.actor ?? { id: input.tenantContext?.userId ?? 'unknown-actor', role: input.tenantContext?.role ?? 'viewer' }
  const signingSecret = options.signingSecret ?? input.signingSecret
  const created = input.releaseAttestation ? { releaseAttestation: input.releaseAttestation } : createReleaseAttestation({ ...input, actor, signedAt: timestamp }, { ...options, emitEvent: false })
  const eligibilityResult = eligibility({ ...input, timestamp })
  const rolePermitted = ['owner', 'admin'].includes(actor.role)
  const canSign = rolePermitted && signingSecret && eligibilityResult.eligible && !['revoked', 'superseded'].includes(created.releaseAttestation.attestationState)
  const content = buildReleaseAttestationContent({ ...input, actor, signedAt: canSign ? timestamp : null })
  const checksum = releaseAttestationChecksum(content)
  const attestation = {
    ...created.releaseAttestation,
    attestationContent: content,
    attestationChecksum: checksum,
    signature: canSign ? signChecksum(checksum, signingSecret) : null,
    signatureIntegrity: canSign ? 'valid' : 'invalid',
    attestationState: canSign ? 'signed' : 'draft',
    signer: actor,
    signedAt: canSign ? timestamp : null,
    blockers: canSign ? [] : [
      ...eligibilityResult.blockers,
      ...(!rolePermitted ? [gateCheck('signing-role', 'Signing role', false, 'Only owner/admin may sign release attestations.')] : []),
      ...(!signingSecret ? [gateCheck('signing-secret', 'Signing configuration', false, 'Signing configuration is missing.')] : []),
    ],
    blockedReason: !rolePermitted ? 'role_not_permitted' : !signingSecret ? 'signing_configuration_missing' : eligibilityResult.blockers.length ? 'release_gate_blocked' : null,
    updatedAt: timestamp,
  }
  return {
    eventType: canSign ? RELEASE_ATTESTATION_EVENTS.signed : RELEASE_ATTESTATION_EVENTS.created,
    timestamp,
    releaseAttestation: attestation,
    releaseAttestationActivity: attestationActivity(attestation, actor, canSign ? 'signed' : 'blocked', input.reason, timestamp),
    signatureMaterialExposed: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function validateReleaseAttestationSignature(attestation = {}, options = {}) {
  const signingSecret = options.signingSecret
  if (!signingSecret || !attestation.signature || attestation.attestationState !== 'signed') return { valid: false, reason: !signingSecret ? 'signing_configuration_missing' : 'unsigned_attestation' }
  const expected = signChecksum(attestation.attestationChecksum, signingSecret)
  return { valid: expected === attestation.signature, reason: expected === attestation.signature ? null : 'signature_mismatch' }
}

function attestationActivity(attestation, actor, action, reason, timestamp) {
  return {
    id: `${attestation.id}-activity-${action}-${Date.parse(timestamp) || Date.now()}`,
    tenantScope: attestation.tenantScope,
    accountId: attestation.accountId,
    releaseCandidateId: attestation.releaseCandidateId,
    attestationId: attestation.id,
    actor,
    action,
    sanitizedNote: sanitize(reason),
    createdAt: timestamp,
    appendOnly: true,
  }
}

export function revokeReleaseAttestation(input = {}, options = {}) {
  const timestamp = options.timestamp ?? nowIso()
  const attestation = input.releaseAttestation ?? input.attestation ?? {}
  const actor = input.actor ?? { id: input.tenantContext?.userId ?? 'unknown-actor', role: input.tenantContext?.role ?? 'viewer' }
  const reason = sanitize(input.reason ?? input.note)
  const valid = ['owner', 'admin'].includes(actor.role) && reason.length > 0 && attestation.attestationState === 'signed'
  const updated = {
    ...attestation,
    attestationState: valid ? 'revoked' : attestation.attestationState ?? 'draft',
    revokedAt: valid ? timestamp : attestation.revokedAt ?? null,
    blockedReason: valid ? null : !['owner', 'admin'].includes(actor.role) ? 'role_not_permitted' : reason.length === 0 ? 'revocation_reason_required' : 'invalid_transition',
    updatedAt: timestamp,
  }
  return {
    eventType: valid ? RELEASE_ATTESTATION_EVENTS.revoked : RELEASE_ATTESTATION_EVENTS.created,
    timestamp,
    releaseAttestation: updated,
    releaseAttestationActivity: attestationActivity(updated, actor, valid ? 'revoked' : 'revoke_rejected', reason, timestamp),
    validTransition: valid,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function supersedeReleaseAttestation(input = {}, options = {}) {
  const current = input.releaseAttestation ?? input.attestation ?? {}
  const created = createReleaseAttestation({ ...input, supersedesAttestationId: current.id, attestationState: 'superseded' }, { ...options, emitEvent: false })
  const result = { ...created, eventType: RELEASE_ATTESTATION_EVENTS.superseded, supersededAttestationId: current.id }
  if (options.emitEvent !== false) (options.eventBus ?? defaultEventBus)?.emit?.(RELEASE_ATTESTATION_EVENTS.superseded, result)
  return result
}

export function evaluateReleaseGate(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? nowIso()
  const scope = tenantScope(input)
  const manifest = input.releaseCandidateManifest ?? {}
  const attestation = input.releaseAttestation ?? {}
  const approval = input.releaseApproval ?? {}
  const expectedMigrationLevel = input.expectedMigrationLevel ?? manifest.databaseMigrationLevel
  const signature = validateReleaseAttestationSignature(attestation, { signingSecret: options.signingSecret ?? input.signingSecret })
  const eligibilityResult = eligibility({ ...input, timestamp })
  const checks = [
    ...eligibilityResult.checks,
    gateCheck('migration-level', 'Migration level matches manifest', !expectedMigrationLevel || expectedMigrationLevel === manifest.databaseMigrationLevel, 'Migration level must match manifest.'),
    gateCheck('test-lint-build-evidence', 'Test, lint, and build evidence', ['functional-test-results', 'regression-test-results', 'lint-results', 'build-results'].every((category) => !eligibilityResult.evidenceSummary.missingCategories.includes(category)), 'Test, lint, and build evidence must be verified.'),
    gateCheck('tenant-paper-evidence', 'Tenant isolation and paper boundary evidence', ['tenant-isolation-verification', 'paper-only-boundary-verification'].every((category) => !eligibilityResult.evidenceSummary.missingCategories.includes(category)), 'Tenant-isolation and paper-only evidence must be verified.'),
    gateCheck('signed-attestation', 'Signed attestation integrity', attestation.attestationState === 'signed' && signature.valid, 'Signed attestation must be valid.'),
    gateCheck('not-revoked', 'No revoked approval or attestation', approval.approvalState !== 'revoked' && attestation.attestationState !== 'revoked', 'Revoked approvals or attestations block release gate.'),
  ]
  const blockers = checks.filter((item) => item.status === 'blocked')
  const state = approval.approvalState === 'revoked' || attestation.attestationState === 'revoked' ? 'revoked' : blockers.length > 0 ? 'blocked' : 'passed'
  const evaluation = {
    id: String(input.id ?? `release-gate-${manifest.releaseCandidateId ?? 'rc'}-${Date.parse(timestamp) || Date.now()}`).slice(0, 220),
    tenantScope: scope,
    accountId: input.accountId ?? manifest.accountId ?? 'paper-portfolio',
    releaseCandidateId: manifest.releaseCandidateId ?? null,
    attestationId: attestation.id ?? null,
    gateState: state,
    checks,
    blockers,
    warnings: checks.filter((item) => item.severity === 'warning'),
    recommendations: blockers.map((item) => item.message).concat('Release gate is advisory and does not deploy or tag releases.'),
    evaluatedAt: timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentAutomation: false,
  }
  const result = {
    eventType: state === 'passed' ? RELEASE_GATE_EVENTS.passed : RELEASE_GATE_EVENTS.blocked,
    evaluatedEventType: RELEASE_GATE_EVENTS.evaluated,
    timestamp,
    releaseGateEvaluation: evaluation,
    gateState: state,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RELEASE_GATE_EVENTS.evaluated, { ...result, eventType: RELEASE_GATE_EVENTS.evaluated })
    eventBus.emit(result.eventType, result)
  }
  return result
}

export function createReleaseAttestationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const attestation = input.releaseAttestation ?? input
      if (!database?.connected) return { ok: true, disabled: true, attestation }
      const result = await database.query(
        `INSERT INTO atlas_release_attestations
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, approval_id, certification_id, runbook_id, production_run_validation_id, attestation_state, attestation_checksum, signer_id, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [attestation.id, attestation.tenantScope.organizationId, attestation.tenantScope.teamWorkspaceId, attestation.accountId, attestation.releaseCandidateId, attestation.approvalId, attestation.certificationId, attestation.runbookId, attestation.productionRunValidationId, attestation.attestationState, attestation.attestationChecksum, attestation.signer?.id ?? null, attestation],
      )
      return { ok: true, attestation: result.rows?.[0]?.payload ?? attestation, immutable: true }
    },
    async appendActivity(input) {
      const activity = input.releaseAttestationActivity ?? input
      if (!database?.connected) return { ok: true, disabled: true, activity }
      await database.query(
        `INSERT INTO atlas_release_attestation_activity
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, attestation_id, actor_id, action, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [activity.id, activity.tenantScope.organizationId, activity.tenantScope.teamWorkspaceId, activity.accountId, activity.releaseCandidateId, activity.attestationId, activity.actor.id, activity.action, activity],
      )
      return { ok: true, activity }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, attestationState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (attestationState) { params.push(String(attestationState)); clauses.push(`attestation_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_attestations
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}

export function createReleaseGateEvaluationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const evaluation = input.releaseGateEvaluation ?? input
      if (!database?.connected) return { ok: true, disabled: true, evaluation }
      const result = await database.query(
        `INSERT INTO atlas_release_gate_evaluations
          (id, organization_id, team_workspace_id, account_id, release_candidate_id, attestation_id, gate_state, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING payload`,
        [evaluation.id, evaluation.tenantScope.organizationId, evaluation.tenantScope.teamWorkspaceId, evaluation.accountId, evaluation.releaseCandidateId, evaluation.attestationId, evaluation.gateState, evaluation],
      )
      return { ok: true, evaluation: result.rows?.[0]?.payload ?? evaluation, immutable: true }
    },
    async list({ tenantContext = {}, accountId, releaseCandidateId, gateState, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) { params.push(String(accountId)); clauses.push(`account_id = $${params.length}`) }
      if (releaseCandidateId) { params.push(String(releaseCandidateId)); clauses.push(`release_candidate_id = $${params.length}`) }
      if (gateState) { params.push(String(gateState)); clauses.push(`gate_state = $${params.length}`) }
      const result = await database.query(
        `SELECT payload FROM atlas_release_gate_evaluations
         WHERE organization_id = $1 AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => row.payload)
    },
  }
}
