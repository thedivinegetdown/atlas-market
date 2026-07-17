import packageJson from '../package.json'
import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createReleaseCandidateManifest } from '../lib/system/releaseCandidatePackagingEngine.js'
import { transitionReleaseApproval, validateProductionRun } from '../lib/system/releaseApprovalWorkflowEngine.js'
import { certifyReleaseCandidate } from '../lib/system/releaseCertificationEngine.js'
import { evaluateReleaseRecoveryReadiness, generateReleaseRunbook } from '../lib/system/releaseRunbookRecoveryEngine.js'
import { registerReleaseEvidence, updateReleaseEvidenceVerification } from '../lib/system/releaseEvidenceRegistryEngine.js'
import { evaluateReleaseGate, signReleaseAttestation } from '../lib/system/releaseAttestationGateEngine.js'
import { createReleaseAcceptanceRun } from '../lib/system/releaseAcceptanceEngine.js'
import { evaluateReleaseHandoff, generateReleaseDocumentation, transitionReleaseDocumentation } from '../lib/system/releaseDocumentationEngine.js'
import { ATLAS_MARKET_VERSION, createMergeReadinessRepository, createReleaseClosureRepository, evaluateMergeReadiness, evaluateReleaseClosure, transitionReleaseClosure } from '../lib/system/releaseClosureMergeReadinessEngine.js'
import { createMergeReadinessHandler } from '../netlify/functions/merge-readiness.js'
import { createReleaseClosureActionHandler } from '../netlify/functions/release-closure-action.js'
import { createReleaseClosureHandler } from '../netlify/functions/release-closure.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }
const releaseSigningSecret = ['phase82', 'signing', 'material'].join('-')

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
      'x-request-id': 'req-phase82',
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

function publishedDocs(base) {
  return ['release_notes', 'operator_guide', 'administrator_guide', 'final_handoff_checklist'].map((documentationType) => {
    const generated = generateReleaseDocumentation({ ...base, tenantContext, documentationType }, { emitEvent: false }).releaseDocumentation
    const validated = transitionReleaseDocumentation({ releaseDocumentation: generated, action: 'validate' }, { emitEvent: false }).releaseDocumentation
    return transitionReleaseDocumentation({ releaseDocumentation: validated, action: 'publish' }, { emitEvent: false }).releaseDocumentation
  })
}

function fixture() {
  const releaseCandidateManifest = createReleaseCandidateManifest({
    tenantContext,
    accountId: 'paper-portfolio',
    releaseCandidateId: 'rc-paper-82',
    gitCommit: 'f2b125f60171db366d9dad8e1e6611256d0de3f4',
    branch: 'part-10-trading-workspace',
    applicationVersion: ATLAS_MARKET_VERSION,
    databaseMigrationLevel: '202607170064_phase82_release_closure_merge_readiness',
    releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy', deploymentBlockers: [], warnings: [] },
    productionConfigurationValidation: { configurationValidationStatus: 'healthy', criticalSummary: [], warningSummary: [] },
    lintSummary: { status: 'passed' },
    buildSummary: { status: 'passed' },
  }, { emitEvent: false }).releaseCandidateManifest
  const releaseApproval = transitionReleaseApproval({ tenantContext, releaseCandidateManifest, actor: { id: userId, role: 'owner' }, decision: 'approved' }, { emitEvent: false }).releaseApproval
  const productionRunValidation = validateProductionRun({ tenantContext, releaseCandidateManifest, releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy' }, productionConfigurationValidation: { configurationValidationStatus: 'healthy' } }, { emitEvent: false }).productionRunValidation
  const releaseCertification = certifyReleaseCandidate({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, validationSummary: { testFileCount: 172, testCount: 970, lint: { status: 'passed' }, build: { status: 'passed' } } }, { emitEvent: false }).releaseCertification
  const runbook = generateReleaseRunbook({ tenantContext, releaseCandidateManifest }, { emitEvent: false })
  const releaseRecoveryReadiness = evaluateReleaseRecoveryReadiness({ releaseRunbook: runbook.releaseRunbook, releaseRunbookItems: runbook.releaseRunbookItems.map((item) => ({ ...item, status: 'completed' })) }, { emitEvent: false }).releaseRecoveryReadiness
  const releaseEvidence = ['functional-test-results', 'regression-test-results', 'lint-results', 'build-results', 'security-review', 'migration-verification', 'tenant-isolation-verification', 'paper-only-boundary-verification', 'production-configuration-validation', 'production-run-validation', 'recovery-readiness-validation'].map((category) => updateReleaseEvidenceVerification({
    releaseEvidence: registerReleaseEvidence({ tenantContext, releaseCandidateManifest, category, sourceType: 'atlas-snapshot-reference', sourceReference: category }, { emitEvent: false }).releaseEvidence,
    actor: { id: userId, role: 'owner' },
    action: 'verified',
  }, { emitEvent: false }).releaseEvidence)
  const releaseAttestation = signReleaseAttestation({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRecoveryReadiness, releaseEvidence, actor: { id: userId, role: 'owner' }, acceptedWarnings: true }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseAttestation
  const releaseGateEvaluation = evaluateReleaseGate({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRecoveryReadiness, releaseEvidence, releaseAttestation, acceptedWarnings: true }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseGateEvaluation
  const releaseAcceptanceRun = createReleaseAcceptanceRun({ tenantContext, releaseCandidateManifest, releaseCertification, releaseRunbook: runbook.releaseRunbook, releaseRecoveryReadiness, releaseAttestation, releaseGateEvaluation, productionRunValidation, suiteType: 'pre_release' }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseAcceptanceRun
  const releaseDocumentation = publishedDocs({ releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRecoveryReadiness, releaseAttestation, releaseGateEvaluation, releaseAcceptanceRun })
  const releaseHandoffEvaluation = evaluateReleaseHandoff({ tenantContext, releaseCandidateManifest, releaseApproval, productionConfigurationValidation: { configurationValidationStatus: 'healthy' }, releaseCertification, releaseRecoveryReadiness, releaseAttestation, releaseGateEvaluation, releaseAcceptanceRun, releaseDocumentation }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseHandoffEvaluation
  return { releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRecoveryReadiness, releaseEvidence, releaseAttestation, releaseGateEvaluation, releaseAcceptanceRun, releaseDocumentation, releaseHandoffEvaluation }
}

describe('Phase 82A release closure', () => {
  it('adds idempotent closure and merge-readiness persistence with parameterized repositories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_closures')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_closure_activity')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_merge_readiness_snapshots')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createReleaseClosureRepository, createMergeReadinessRepository]) {
      const query = vi.fn(async () => ({ rows: [{ payload: { ok: true } }] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ tenantScope: tenantContext, accountId: 'paper-portfolio', releaseCandidateId: 'rc', version: '1.0.0', closureState: 'ready', closureChecksum: 'fnv1a-1', mergeRecommendation: 'ready_for_pr', commit: 'abc', checksum: 'fnv1a-2' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('evaluates ready closure, deterministic checksum, closure lifecycle, revocation, superseding, and terminal immutability', () => {
    const base = fixture()
    const ready = evaluateReleaseClosure({ ...base, tenantContext, closureNote: 'Ready for human-reviewed PR.', acceptedWarnings: true }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const repeated = evaluateReleaseClosure({ ...base, tenantContext, closureNote: 'Ready for human-reviewed PR.', acceptedWarnings: true }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const closed = transitionReleaseClosure({ releaseClosure: ready.releaseClosure, actor: { id: userId, role: 'owner' }, action: 'close', closureNote: 'Closure approved for paper release.' }, { emitEvent: false })
    const revokedMissingReason = transitionReleaseClosure({ releaseClosure: closed.releaseClosure, actor: { id: userId, role: 'owner' }, action: 'revoke' }, { emitEvent: false })
    const revoked = transitionReleaseClosure({ releaseClosure: closed.releaseClosure, actor: { id: userId, role: 'owner' }, action: 'revoke', reason: 'Human review found a stale external checklist.' }, { emitEvent: false })
    const terminalMutation = transitionReleaseClosure({ releaseClosure: closed.releaseClosure, actor: { id: userId, role: 'owner' }, action: 'close', closureNote: 'duplicate' }, { emitEvent: false })
    const superseded = transitionReleaseClosure({ releaseClosure: ready.releaseClosure, actor: { id: userId, role: 'admin' }, action: 'supersede', closureNote: 'New closure supersedes this one.' }, { emitEvent: false })
    expect(ready.closureState).toBe('ready')
    expect(ready.releaseClosure.closureChecksum).toBe(repeated.releaseClosure.closureChecksum)
    expect(closed.releaseClosure.closureState).toBe('closed')
    expect(closed.releaseClosureActivity.appendOnly).toBe(true)
    expect(revokedMissingReason.validTransition).toBe(false)
    expect(revoked.releaseClosure.closureState).toBe('revoked')
    expect(terminalMutation.validTransition).toBe(false)
    expect(superseded.releaseClosure.closureState).toBe('superseded')
  })

  it('blocks missing prerequisites, critical configuration findings, migration mismatch, live trading, and non-owner closure decisions', () => {
    const base = fixture()
    const missingDocs = evaluateReleaseClosure({ ...base, tenantContext, releaseDocumentation: base.releaseDocumentation.slice(0, 2) }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const revokedApproval = evaluateReleaseClosure({ ...base, tenantContext, releaseApproval: { ...base.releaseApproval, approvalState: 'revoked' } }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const criticalConfig = evaluateReleaseClosure({ ...base, tenantContext, productionConfigurationValidation: { configurationValidationStatus: 'blocked', criticalSummary: [{ message: 'missing config' }] } }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const migrationMismatch = evaluateReleaseClosure({ ...base, tenantContext, expectedMigrationLevel: 'older-migration' }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const liveTrading = evaluateReleaseClosure({ ...base, tenantContext, liveTradingEnabled: true }, { emitEvent: false, signingSecret: releaseSigningSecret })
    const analystClose = transitionReleaseClosure({ releaseClosure: evaluateReleaseClosure({ ...base, tenantContext }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseClosure, actor: { id: userId, role: 'analyst' }, action: 'close', closureNote: 'nope' }, { emitEvent: false })
    expect(missingDocs.closureState).toBe('blocked')
    expect(revokedApproval.closureState).toBe('blocked')
    expect(criticalConfig.closureState).toBe('blocked')
    expect(migrationMismatch.closureState).toBe('blocked')
    expect(liveTrading.closureState).toBe('blocked')
    expect(analystClose.validTransition).toBe(false)
  })
})

describe('Phase 82B version freeze and merge readiness', () => {
  it('uses canonical version 1.0.0 and derives ready, warning, and blocked merge-readiness server-side', () => {
    const base = fixture()
    const closure = transitionReleaseClosure({ releaseClosure: evaluateReleaseClosure({ ...base, tenantContext }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseClosure, actor: { id: userId, role: 'owner' }, action: 'close', closureNote: 'Ready.' }, { emitEvent: false }).releaseClosure
    const ready = evaluateMergeReadiness({ ...base, tenantContext, releaseClosure: closure, version: ATLAS_MARKET_VERSION, totalTestFiles: 172, totalTests: 970, testResult: 'passed', lintResult: 'passed', buildResult: 'passed', sensitiveMaterialScanResult: 'passed' }, { emitEvent: false })
    const warning = evaluateMergeReadiness({ ...base, tenantContext, releaseClosure: closure, version: ATLAS_MARKET_VERSION, totalTestFiles: 172, totalTests: 970, testResult: 'passed', lintResult: 'passed', buildResult: 'passed', sensitiveMaterialScanResult: 'passed', knownWarnings: ['existing lint warnings remain unchanged'] }, { emitEvent: false })
    const blocked = evaluateMergeReadiness({ ...base, tenantContext, releaseClosure: { ...closure, closureState: 'blocked' }, version: 'client-supplied-wrong-version', testResult: 'failed', lintResult: 'passed', buildResult: 'passed', sensitiveMaterialScanResult: 'passed' }, { emitEvent: false })
    expect(packageJson.version).toBe('1.0.0')
    expect(ATLAS_MARKET_VERSION).toBe('1.0.0')
    expect(ready.mergeRecommendation).toBe('ready_for_pr')
    expect(ready.mergeReadinessSnapshot.version).toBe('1.0.0')
    expect(warning.mergeRecommendation).toBe('ready_with_warnings')
    expect(blocked.mergeRecommendation).toBe('not_ready')
    expect(blocked.mergeReadinessSnapshot.paperTrading).toBe(true)
    expect(blocked.mergeReadinessSnapshot.deploymentAutomation).toBe(false)
  })

  it('serves protected closure and merge-readiness APIs with viewer read-only, owner/admin actions, safe public errors, and cross-tenant denial', async () => {
    const base = fixture()
    const closure = evaluateReleaseClosure({ ...base, tenantContext }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseClosure
    const releaseClosureRepository = { list: vi.fn(async () => [closure]), create: vi.fn(async () => ({ ok: true })), appendActivity: vi.fn(async () => ({ ok: true })) }
    const mergeReadinessRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })) }
    const viewerOptions = { accountId: 'paper-portfolio', releaseSigningSecret, organizationMembershipRepository: membershipRepository('viewer'), releaseClosureRepository, mergeReadinessRepository }
    const ownerOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('owner') }
    const viewerRead = parseResponse(await createReleaseClosureHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const viewerWrite = parseResponse(await createReleaseClosureHandler(viewerOptions)(authEvent('POST', base, 'viewer')))
    const ownerEvaluate = parseResponse(await createReleaseClosureHandler(ownerOptions)(authEvent('POST', base, 'owner')))
    const ownerClose = parseResponse(await createReleaseClosureActionHandler(ownerOptions)(authEvent('POST', { releaseClosure: closure, action: 'close', closureNote: 'Ready for PR.' }, 'owner')))
    const ownerMerge = parseResponse(await createMergeReadinessHandler(ownerOptions)(authEvent('POST', { ...base, releaseClosure: { ...closure, closureState: 'closed' }, testResult: 'passed', lintResult: 'passed', buildResult: 'passed', sensitiveMaterialScanResult: 'passed' }, 'owner')))
    const crossTenant = parseResponse(await createMergeReadinessHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect(viewerRead.statusCode).toBe(200)
    expect(viewerWrite.statusCode).toBe(403)
    expect(ownerEvaluate.statusCode).toBe(200)
    expect(ownerClose.statusCode).toBe(200)
    expect(ownerMerge.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
    expect(JSON.stringify(ownerMerge.json)).not.toContain('client-supplied-role')
  })
})
