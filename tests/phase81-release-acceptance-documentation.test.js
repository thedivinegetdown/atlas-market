import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createReleaseCandidateManifest } from '../lib/system/releaseCandidatePackagingEngine.js'
import { transitionReleaseApproval, validateProductionRun } from '../lib/system/releaseApprovalWorkflowEngine.js'
import { certifyReleaseCandidate } from '../lib/system/releaseCertificationEngine.js'
import { evaluateReleaseRecoveryReadiness, generateReleaseRunbook } from '../lib/system/releaseRunbookRecoveryEngine.js'
import { registerReleaseEvidence, summarizeReleaseEvidence, updateReleaseEvidenceVerification } from '../lib/system/releaseEvidenceRegistryEngine.js'
import { evaluateReleaseGate, signReleaseAttestation } from '../lib/system/releaseAttestationGateEngine.js'
import { cancelReleaseAcceptanceRun, createReleaseAcceptanceRepository, createReleaseAcceptanceRun } from '../lib/system/releaseAcceptanceEngine.js'
import { createReleaseDocumentationRepository, createReleaseHandoffRepository, evaluateReleaseHandoff, generateReleaseDocumentation, transitionReleaseDocumentation } from '../lib/system/releaseDocumentationEngine.js'
import { createReleaseAcceptanceHandler } from '../netlify/functions/release-acceptance.js'
import { createReleaseAcceptanceActionHandler } from '../netlify/functions/release-acceptance-action.js'
import { createReleaseDocumentationHandler } from '../netlify/functions/release-documentation.js'
import { createReleaseDocumentationActionHandler } from '../netlify/functions/release-documentation-action.js'
import { createReleaseHandoffHandler } from '../netlify/functions/release-handoff.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }
const releaseSigningSecret = 'phase81-signing-material'

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
      'x-request-id': 'req-phase81',
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

function fixture() {
  const releaseCandidateManifest = createReleaseCandidateManifest({
    tenantContext,
    accountId: 'paper-portfolio',
    releaseCandidateId: 'rc-paper-81',
    gitCommit: 'abc810',
    branch: 'part-10-trading-workspace',
    applicationVersion: '1.0.0',
    databaseMigrationLevel: '202607170063_phase81_release_acceptance_documentation',
    releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy', deploymentBlockers: [], warnings: [] },
    productionConfigurationValidation: { configurationValidationStatus: 'healthy', criticalSummary: [], warningSummary: [] },
    lintSummary: { status: 'passed' },
    buildSummary: { status: 'passed' },
  }, { emitEvent: false }).releaseCandidateManifest
  const releaseApproval = transitionReleaseApproval({ tenantContext, releaseCandidateManifest, actor: { id: userId, role: 'owner' }, decision: 'approved' }, { emitEvent: false }).releaseApproval
  const productionRunValidation = validateProductionRun({ tenantContext, releaseCandidateManifest, releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy' }, productionConfigurationValidation: { configurationValidationStatus: 'healthy' } }, { emitEvent: false }).productionRunValidation
  const releaseCertification = certifyReleaseCandidate({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, validationSummary: { testFileCount: 171, testCount: 960, lint: { status: 'passed' }, build: { status: 'passed' } } }, { emitEvent: false }).releaseCertification
  const runbook = generateReleaseRunbook({ tenantContext, releaseCandidateManifest }, { emitEvent: false })
  const releaseRecoveryReadiness = evaluateReleaseRecoveryReadiness({ releaseRunbook: runbook.releaseRunbook, releaseRunbookItems: runbook.releaseRunbookItems.map((item) => ({ ...item, status: 'completed' })) }, { emitEvent: false }).releaseRecoveryReadiness
  const releaseEvidence = ['functional-test-results', 'regression-test-results', 'lint-results', 'build-results', 'migration-verification', 'tenant-isolation-verification', 'paper-only-boundary-verification', 'production-configuration-validation', 'production-run-validation', 'recovery-readiness-validation'].map((category) => updateReleaseEvidenceVerification({
    releaseEvidence: registerReleaseEvidence({ tenantContext, releaseCandidateManifest, category, sourceType: 'atlas-snapshot-reference', sourceReference: category }, { emitEvent: false }).releaseEvidence,
    actor: { id: userId, role: 'owner' },
    action: 'verified',
  }, { emitEvent: false }).releaseEvidence)
  const evidenceSummary = summarizeReleaseEvidence(releaseEvidence)
  const releaseAttestation = signReleaseAttestation({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRecoveryReadiness, releaseEvidence, evidenceSummary, actor: { id: userId, role: 'owner' }, acceptedWarnings: true }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseAttestation
  const releaseGateEvaluation = evaluateReleaseGate({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRecoveryReadiness, releaseEvidence, evidenceSummary, releaseAttestation, acceptedWarnings: true }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseGateEvaluation
  return { releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRunbook: runbook.releaseRunbook, releaseRecoveryReadiness, releaseEvidence, evidenceSummary, releaseAttestation, releaseGateEvaluation }
}

function publishedDocs(base) {
  return ['release_notes', 'operator_guide', 'administrator_guide', 'final_handoff_checklist'].map((documentationType) => {
    const generated = generateReleaseDocumentation({ ...base, tenantContext, documentationType }, { emitEvent: false }).releaseDocumentation
    const validated = transitionReleaseDocumentation({ releaseDocumentation: generated, action: 'validate' }, { emitEvent: false }).releaseDocumentation
    return transitionReleaseDocumentation({ releaseDocumentation: validated, action: 'publish' }, { emitEvent: false }).releaseDocumentation
  })
}

describe('Phase 81A acceptance validation framework', () => {
  it('adds idempotent acceptance and documentation persistence with parameterized repositories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_acceptance_runs')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_acceptance_checks')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_documentation')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_handoff_evaluations')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createReleaseAcceptanceRepository, createReleaseDocumentationRepository, createReleaseHandoffRepository]) {
      const query = vi.fn(async () => ({ rows: [{ payload: { ok: true } }] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ tenantScope: tenantContext, accountId: 'paper-portfolio', releaseCandidateId: 'rc', suiteType: 'pre_release', runState: 'passed', idempotencyKey: 'key', documentationType: 'release_notes', version: '1.0.0', documentationState: 'published', checksum: 'fnv1a-1', handoffState: 'completed' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('creates bounded acceptance runs, validates suite types, suppresses duplicate active runs, and supports cancellation or terminal immutability', () => {
    const base = fixture()
    const passed = createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'pre_release' }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const duplicate = createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'pre_release', existingRuns: [{ ...passed.releaseAcceptanceRun, runState: 'running' }] }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const smokeSkipped = createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'post_deployment_smoke', paperSmokeAuthorized: false }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const running = createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'recovery_validation', runState: 'running' }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const cancelled = cancelReleaseAcceptanceRun({ releaseAcceptanceRun: running.releaseAcceptanceRun }, { emitEvent: false })
    const immutable = cancelReleaseAcceptanceRun({ releaseAcceptanceRun: passed.releaseAcceptanceRun }, { emitEvent: false })
    const expired = createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'pre_release', runState: 'expired' }, { emitEvent: false, signingSecret: releaseSigningSecret })
    expect(passed.releaseAcceptanceRun.runState).toBe('passed')
    expect(passed.releaseAcceptanceChecks.length).toBeLessThanOrEqual(32)
    expect(duplicate.duplicateSuppressed).toBe(true)
    expect(smokeSkipped.releaseAcceptanceRun.skippedCount).toBeGreaterThan(0)
    expect(cancelled.releaseAcceptanceRun.runState).toBe('cancelled')
    expect(immutable.validTransition).toBe(false)
    expect(expired.releaseAcceptanceRun.runState).toBe('expired')
    expect(createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'invalid-suite' }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseAcceptanceRun.suiteType).toBe('pre_release')
  })
})

describe('Phase 81B release documentation and final handoff', () => {
  it('generates deterministic sanitized documentation, validates, publishes immutably, and supersedes historical versions', () => {
    const base = fixture()
    const first = generateReleaseDocumentation({ ...base, tenantContext, documentationType: 'release_notes', securityHardeningSummary: 'no token secret https://private.example/path' }, { emitEvent: false, timestamp: '2026-07-17T10:00:00.000Z' })
    const second = generateReleaseDocumentation({ ...base, tenantContext, documentationType: 'release_notes', securityHardeningSummary: 'no token secret https://private.example/path' }, { emitEvent: false, timestamp: '2026-07-17T10:00:00.000Z' })
    const validated = transitionReleaseDocumentation({ releaseDocumentation: first.releaseDocumentation, action: 'validate' }, { emitEvent: false })
    const published = transitionReleaseDocumentation({ releaseDocumentation: validated.releaseDocumentation, action: 'publish' }, { emitEvent: false })
    const invalidMutation = transitionReleaseDocumentation({ releaseDocumentation: published.releaseDocumentation, action: 'validate' }, { emitEvent: false })
    const superseded = transitionReleaseDocumentation({ releaseDocumentation: published.releaseDocumentation, action: 'supersede' }, { emitEvent: false })
    expect(first.releaseDocumentation.checksum).toBe(second.releaseDocumentation.checksum)
    expect(JSON.stringify(first.releaseDocumentation)).not.toContain('private.example')
    expect(validated.releaseDocumentation.documentationState).toBe('validated')
    expect(published.releaseDocumentation.documentationState).toBe('published')
    expect(published.releaseDocumentation.immutable).toBe(true)
    expect(invalidMutation.validTransition).toBe(false)
    expect(superseded.releaseDocumentation.documentationState).toBe('superseded')
  })

  it('evaluates final handoff pass and blocks missing acceptance, documentation, attestation, or gate prerequisites', () => {
    const base = fixture()
    const releaseAcceptanceRun = createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'pre_release' }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseAcceptanceRun
    const documents = publishedDocs({ ...base, releaseAcceptanceRun })
    const completed = evaluateReleaseHandoff({ ...base, tenantContext, releaseAcceptanceRun, releaseDocumentation: documents }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const missingDocs = evaluateReleaseHandoff({ ...base, tenantContext, releaseAcceptanceRun, releaseDocumentation: documents.slice(0, 2) }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const missingAcceptance = evaluateReleaseHandoff({ ...base, tenantContext, releaseDocumentation: documents }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const invalidGate = evaluateReleaseHandoff({ ...base, tenantContext, releaseAcceptanceRun, releaseDocumentation: documents, releaseGateEvaluation: { ...base.releaseGateEvaluation, gateState: 'blocked' } }, { emitEvent: false, signingSecret: releaseSigningSecret })
    expect(completed.handoffState).toBe('completed')
    expect(missingDocs.handoffState).toBe('blocked')
    expect(missingAcceptance.handoffState).toBe('blocked')
    expect(invalidGate.handoffState).toBe('blocked')
  })

  it('serves protected acceptance, documentation, and handoff APIs with viewer read-only, analyst draft permissions, owner/admin actions, and cross-tenant denial', async () => {
    const base = fixture()
    const releaseAcceptanceRun = createReleaseAcceptanceRun({ ...base, tenantContext, suiteType: 'pre_release' }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseAcceptanceRun
    const docs = publishedDocs({ ...base, releaseAcceptanceRun })
    const acceptanceRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })), createCheck: vi.fn(async () => ({ ok: true })) }
    const documentationRepository = { list: vi.fn(async () => docs), create: vi.fn(async () => ({ ok: true })) }
    const handoffRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })) }
    const viewerOptions = { accountId: 'paper-portfolio', releaseSigningSecret, organizationMembershipRepository: membershipRepository('viewer'), releaseAcceptanceRepository: acceptanceRepository, releaseDocumentationRepository: documentationRepository, releaseHandoffRepository: handoffRepository }
    const analystOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') }
    const ownerOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('owner') }
    const readRuns = parseResponse(await createReleaseAcceptanceHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const analystRun = parseResponse(await createReleaseAcceptanceHandler(analystOptions)(authEvent('POST', { ...base, suiteType: 'pre_release' }, 'analyst')))
    const analystSmokeDenied = parseResponse(await createReleaseAcceptanceHandler(analystOptions)(authEvent('POST', { ...base, suiteType: 'post_deployment_smoke', paperSmokeAuthorized: true }, 'analyst')))
    const ownerCancel = parseResponse(await createReleaseAcceptanceActionHandler(ownerOptions)(authEvent('POST', { releaseAcceptanceRun: { ...releaseAcceptanceRun, runState: 'running' }, action: 'cancel' }, 'owner')))
    const viewerDocRead = parseResponse(await createReleaseDocumentationHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const analystDocDraft = parseResponse(await createReleaseDocumentationHandler(analystOptions)(authEvent('POST', { ...base, documentationType: 'operator_guide' }, 'analyst')))
    const analystPublishDenied = parseResponse(await createReleaseDocumentationActionHandler(analystOptions)(authEvent('POST', { releaseDocumentation: docs[0], action: 'publish' }, 'analyst')))
    const ownerPublish = parseResponse(await createReleaseDocumentationActionHandler(ownerOptions)(authEvent('POST', { releaseDocumentation: { ...docs[0], documentationState: 'validated' }, action: 'publish' }, 'owner')))
    const handoff = parseResponse(await createReleaseHandoffHandler(ownerOptions)(authEvent('POST', { ...base, releaseAcceptanceRun, releaseDocumentation: docs }, 'owner')))
    const crossTenant = parseResponse(await createReleaseAcceptanceHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect(readRuns.statusCode).toBe(200)
    expect(analystRun.statusCode).toBe(200)
    expect(analystSmokeDenied.statusCode).toBe(403)
    expect(ownerCancel.statusCode).toBe(200)
    expect(viewerDocRead.statusCode).toBe(200)
    expect(analystDocDraft.statusCode).toBe(200)
    expect(analystPublishDenied.statusCode).toBe(403)
    expect(ownerPublish.statusCode).toBe(200)
    expect(handoff.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
