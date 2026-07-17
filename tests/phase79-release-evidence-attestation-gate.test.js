import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createReleaseCandidateManifest } from '../lib/system/releaseCandidatePackagingEngine.js'
import { transitionReleaseApproval, validateProductionRun } from '../lib/system/releaseApprovalWorkflowEngine.js'
import { certifyReleaseCandidate } from '../lib/system/releaseCertificationEngine.js'
import { evaluateReleaseRecoveryReadiness, generateReleaseRunbook } from '../lib/system/releaseRunbookRecoveryEngine.js'
import { createReleaseEvidenceFingerprint, createReleaseEvidenceRepository, registerReleaseEvidence, summarizeReleaseEvidence, supersedeReleaseEvidence, updateReleaseEvidenceVerification } from '../lib/system/releaseEvidenceRegistryEngine.js'
import { buildReleaseAttestationContent, createReleaseAttestationRepository, createReleaseGateEvaluationRepository, evaluateReleaseGate, releaseAttestationChecksum, revokeReleaseAttestation, signReleaseAttestation, supersedeReleaseAttestation, validateReleaseAttestationSignature } from '../lib/system/releaseAttestationGateEngine.js'
import { createReleaseEvidenceHandler } from '../netlify/functions/release-evidence.js'
import { createReleaseEvidenceActionHandler } from '../netlify/functions/release-evidence-action.js'
import { createReleaseAttestationsHandler } from '../netlify/functions/release-attestations.js'
import { createReleaseAttestationActionHandler } from '../netlify/functions/release-attestation-action.js'
import { createReleaseGateHandler } from '../netlify/functions/release-gate.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }
const signingSecret = 'phase79-test-signing-material'

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'owner', organizationId = 'org-atlas-local') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase79',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function membershipRepository(role = 'owner') {
  return {
    getMembership: vi.fn(async (organizationId) => organizationId === 'org-atlas-local'
      ? { id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' }
      : null),
  }
}

function fixtures() {
  const releaseCandidateManifest = createReleaseCandidateManifest({
    tenantContext,
    accountId: 'paper-portfolio',
    releaseCandidateId: 'rc-paper-79',
    gitCommit: 'abc790',
    branch: 'part-10-trading-workspace',
    applicationVersion: '0.0.0',
    databaseMigrationLevel: '202607160062_phase79_release_evidence_attestation_gate',
    releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy', deploymentBlockers: [], warnings: [] },
    productionConfigurationValidation: { configurationValidationStatus: 'healthy', criticalSummary: [], warningSummary: [] },
    buildSummary: { status: 'passed' },
    lintSummary: { status: 'passed' },
  }, { emitEvent: false }).releaseCandidateManifest
  const releaseApproval = transitionReleaseApproval({ tenantContext, releaseCandidateManifest, actor: { id: userId, role: 'owner' }, decision: 'approved' }, { emitEvent: false }).releaseApproval
  const productionRunValidation = validateProductionRun({ tenantContext, releaseCandidateManifest, productionConfigurationValidation: { configurationValidationStatus: 'healthy' }, releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy' } }, { emitEvent: false }).productionRunValidation
  const releaseCertification = certifyReleaseCandidate({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, validationSummary: { testFileCount: 170, testCount: 950, lint: { status: 'passed' }, build: { status: 'passed' } } }, { emitEvent: false }).releaseCertification
  const runbook = generateReleaseRunbook({ tenantContext, releaseCandidateManifest }, { emitEvent: false })
  const completedItems = runbook.releaseRunbookItems.map((item) => ({ ...item, status: 'completed', completedAt: '2026-07-16T12:00:00.000Z' }))
  const releaseRecoveryReadiness = evaluateReleaseRecoveryReadiness({ releaseRunbook: runbook.releaseRunbook, releaseRunbookItems: completedItems }, { emitEvent: false }).releaseRecoveryReadiness
  const categories = ['functional-test-results', 'regression-test-results', 'lint-results', 'build-results', 'migration-verification', 'tenant-isolation-verification', 'paper-only-boundary-verification', 'production-configuration-validation', 'production-run-validation', 'recovery-readiness-validation']
  const releaseEvidence = categories.map((category) => updateReleaseEvidenceVerification({
    releaseEvidence: registerReleaseEvidence({
      tenantContext,
      releaseCandidateManifest,
      certificationId: releaseCertification.id,
      runbookId: runbook.releaseRunbook.id,
      approvalId: releaseApproval.id,
      productionRunValidationId: productionRunValidation.id,
      category,
      sourceType: 'atlas-snapshot-reference',
      sourceReference: `${releaseCandidateManifest.releaseCandidateId}:${category}`,
      checksum: `checksum-${category}`,
    }, { emitEvent: false }).releaseEvidence,
    actor: { id: userId, role: 'owner' },
    action: 'verified',
  }, { emitEvent: false }).releaseEvidence)
  const evidenceSummary = summarizeReleaseEvidence(releaseEvidence)
  return { releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRunbook: runbook.releaseRunbook, releaseRecoveryReadiness, releaseEvidence, evidenceSummary }
}

describe('Phase 79A release evidence registry and verification', () => {
  it('adds idempotent evidence, attestation, and gate persistence with parameterized repositories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_evidence')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_evidence_activity')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_attestations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_attestation_activity')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_gate_evaluations')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createReleaseEvidenceRepository, createReleaseAttestationRepository, createReleaseGateEvaluationRepository]) {
      const query = vi.fn(async () => ({ rows: [{ payload: { ok: true } }] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ tenantScope: tenantContext, accountId: 'paper-portfolio', releaseCandidateId: 'rc', category: 'functional-test-results', sourceType: 'atlas-snapshot-reference', verificationState: 'verified', fingerprint: 'fp', attestationState: 'signed', attestationChecksum: 'fnv1a-1', gateState: 'passed', signer: { id: userId } })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('registers, fingerprints, suppresses duplicates, verifies, rejects, expires, and supersedes evidence safely', () => {
    const base = fixtures()
    const input = { tenantContext, releaseCandidateManifest: base.releaseCandidateManifest, category: 'functional-test-results', sourceType: 'atlas-snapshot-reference', sourceReference: 'npm test' }
    const fingerprint = createReleaseEvidenceFingerprint(input)
    const registered = registerReleaseEvidence(input, { emitEvent: false, timestamp: '2026-07-16T12:00:00.000Z' })
    const duplicate = registerReleaseEvidence({ ...input, existingEvidence: [registered.releaseEvidence] }, { emitEvent: false })
    const verified = updateReleaseEvidenceVerification({ releaseEvidence: registered.releaseEvidence, actor: { id: userId, role: 'analyst' }, action: 'verified' }, { emitEvent: false })
    const rejected = updateReleaseEvidenceVerification({ releaseEvidence: registered.releaseEvidence, actor: { id: userId, role: 'analyst' }, action: 'reject', reason: 'bad reference' }, { emitEvent: false })
    const expired = registerReleaseEvidence({ ...input, expiresAt: '2026-01-01T00:00:00.000Z' }, { emitEvent: false, timestamp: '2026-07-16T12:00:00.000Z' })
    const crossTenant = registerReleaseEvidence({ ...input, sourceTenantScope: { organizationId: 'org-other' } }, { emitEvent: false })
    const crossRelease = registerReleaseEvidence({ ...input, sourceReleaseCandidateId: 'rc-other' }, { emitEvent: false })
    const superseded = supersedeReleaseEvidence({ releaseEvidence: verified.releaseEvidence, sourceReference: 'npm test rerun' }, { emitEvent: false })
    expect(registered.releaseEvidence.fingerprint).toBe(fingerprint)
    expect(duplicate.duplicateSuppressed).toBe(true)
    expect(verified.releaseEvidence.verificationState).toBe('verified')
    expect(rejected.releaseEvidence.verificationState).toBe('rejected')
    expect(expired.releaseEvidence.verificationState).toBe('expired')
    expect(crossTenant.releaseEvidence.blockedReason).toBe('cross_tenant_reference')
    expect(crossRelease.releaseEvidence.blockedReason).toBe('cross_release_reference')
    expect(superseded.eventType).toBe('releaseEvidence.superseded')
    expect(verified.releaseEvidenceActivity.appendOnly).toBe(true)
  })
})

describe('Phase 79B signed attestation and final release gate', () => {
  it('creates deterministic content, signs without exposing secrets, validates integrity, and blocks missing signing configuration or evidence', () => {
    const base = fixtures()
    const firstContent = buildReleaseAttestationContent({ ...base, actor: { id: userId, role: 'owner' }, signedAt: '2026-07-16T12:10:00.000Z' })
    const secondContent = buildReleaseAttestationContent({ ...base, actor: { id: userId, role: 'owner' }, signedAt: '2026-07-16T12:10:00.000Z' })
    const signed = signReleaseAttestation({ ...base, tenantContext, actor: { id: userId, role: 'owner' }, acceptedWarnings: true }, { emitEvent: false, signingSecret, timestamp: '2026-07-16T12:10:00.000Z' })
    const missingSecret = signReleaseAttestation({ ...base, tenantContext, actor: { id: userId, role: 'owner' }, acceptedWarnings: true }, { emitEvent: false, timestamp: '2026-07-16T12:10:00.000Z' })
    const missingEvidence = signReleaseAttestation({ ...base, tenantContext, releaseEvidence: base.releaseEvidence.slice(0, 2), evidenceSummary: summarizeReleaseEvidence(base.releaseEvidence.slice(0, 2)), actor: { id: userId, role: 'owner' }, acceptedWarnings: true }, { emitEvent: false, signingSecret })
    expect(releaseAttestationChecksum(firstContent)).toBe(releaseAttestationChecksum(secondContent))
    expect(signed.releaseAttestation.attestationState).toBe('signed')
    expect(signed.signatureMaterialExposed).toBe(false)
    expect(JSON.stringify(signed)).not.toContain(signingSecret)
    expect(validateReleaseAttestationSignature(signed.releaseAttestation, { signingSecret }).valid).toBe(true)
    expect(validateReleaseAttestationSignature({ ...signed.releaseAttestation, signature: 'tampered' }, { signingSecret }).valid).toBe(false)
    expect(missingSecret.releaseAttestation.blockedReason).toBe('signing_configuration_missing')
    expect(missingEvidence.releaseAttestation.blockedReason).toBe('release_gate_blocked')
  })

  it('enforces signing authorization, revocation reason, superseding, migration matching, revoked blocking, and final gate pass/block states', () => {
    const base = fixtures()
    const viewerSign = signReleaseAttestation({ ...base, tenantContext, actor: { id: userId, role: 'viewer' }, acceptedWarnings: true }, { emitEvent: false, signingSecret })
    const signed = signReleaseAttestation({ ...base, tenantContext, actor: { id: userId, role: 'admin' }, acceptedWarnings: true }, { emitEvent: false, signingSecret })
    const missingReason = revokeReleaseAttestation({ releaseAttestation: signed.releaseAttestation, actor: { id: userId, role: 'admin' } }, { emitEvent: false })
    const revoked = revokeReleaseAttestation({ releaseAttestation: signed.releaseAttestation, actor: { id: userId, role: 'admin' }, reason: 'Superseded by final paper package.' }, { emitEvent: false })
    const superseded = supersedeReleaseAttestation({ ...base, tenantContext, releaseAttestation: signed.releaseAttestation }, { emitEvent: false })
    const passedGate = evaluateReleaseGate({ ...base, tenantContext, releaseAttestation: signed.releaseAttestation, acceptedWarnings: true }, { emitEvent: false, signingSecret })
    const migrationBlocked = evaluateReleaseGate({ ...base, tenantContext, releaseAttestation: signed.releaseAttestation, expectedMigrationLevel: 'other-migration', acceptedWarnings: true }, { emitEvent: false, signingSecret })
    const revokedGate = evaluateReleaseGate({ ...base, tenantContext, releaseAttestation: revoked.releaseAttestation, acceptedWarnings: true }, { emitEvent: false, signingSecret })
    expect(viewerSign.releaseAttestation.blockedReason).toBe('role_not_permitted')
    expect(missingReason.releaseAttestation.blockedReason).toBe('revocation_reason_required')
    expect(revoked.releaseAttestation.attestationState).toBe('revoked')
    expect(superseded.eventType).toBe('releaseAttestation.superseded')
    expect(passedGate.gateState).toBe('passed')
    expect(migrationBlocked.gateState).toBe('blocked')
    expect(revokedGate.gateState).toBe('revoked')
    expect(revoked.releaseAttestationActivity.appendOnly).toBe(true)
  })

  it('serves protected evidence, attestation, and release-gate APIs with read-only viewer, analyst evidence permissions, owner signing, and cross-tenant denial', async () => {
    const base = fixtures()
    const evidenceRepository = { list: vi.fn(async () => base.releaseEvidence), create: vi.fn(async () => ({ ok: true })), appendActivity: vi.fn(async () => ({ ok: true })) }
    const attestationRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })), appendActivity: vi.fn(async () => ({ ok: true })) }
    const gateRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })) }
    const viewerOptions = { accountId: 'paper-portfolio', organizationMembershipRepository: membershipRepository('viewer'), releaseEvidenceRepository: evidenceRepository, releaseAttestationRepository: attestationRepository, releaseGateEvaluationRepository: gateRepository, releaseSigningSecret: signingSecret }
    const analystOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') }
    const ownerOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('owner') }
    const evidenceRead = parseResponse(await createReleaseEvidenceHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const evidenceWrite = parseResponse(await createReleaseEvidenceHandler(analystOptions)(authEvent('POST', { releaseCandidateManifest: base.releaseCandidateManifest, category: 'manual-qa-evidence', sourceType: 'manual-metadata', sourceReference: 'manual-qa' }, 'analyst')))
    const evidenceAction = parseResponse(await createReleaseEvidenceActionHandler(analystOptions)(authEvent('POST', { releaseEvidence: base.releaseEvidence[0], action: 'verified' }, 'analyst')))
    const attestationDenied = parseResponse(await createReleaseAttestationsHandler(analystOptions)(authEvent('POST', base, 'analyst')))
    const attestationAction = parseResponse(await createReleaseAttestationActionHandler(ownerOptions)(authEvent('POST', { ...base, action: 'sign', actor: { id: userId, role: 'owner' } }, 'owner')))
    const gateRead = parseResponse(await createReleaseGateHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const gateWrite = parseResponse(await createReleaseGateHandler(ownerOptions)(authEvent('POST', { ...base, releaseAttestation: signReleaseAttestation({ ...base, actor: { id: userId, role: 'owner' }, acceptedWarnings: true }, { emitEvent: false, signingSecret }).releaseAttestation, signingSecret }, 'owner')))
    const crossTenant = parseResponse(await createReleaseEvidenceHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect(evidenceRead.statusCode).toBe(200)
    expect(evidenceWrite.statusCode).toBe(200)
    expect(evidenceAction.statusCode).toBe(200)
    expect(attestationDenied.statusCode).toBe(403)
    expect(attestationAction.statusCode).toBe(200)
    expect(gateRead.statusCode).toBe(200)
    expect(gateWrite.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
