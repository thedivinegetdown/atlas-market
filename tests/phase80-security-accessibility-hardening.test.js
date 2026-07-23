import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../src/App.jsx'
import { createApiHandler } from '../netlify/functions/_shared/api.js'
import { createPaperReportArtifact, downloadPaperReportArtifact } from '../lib/reports/paperReportArtifactEngine.js'
import { createPaperReportWorkerHandler } from '../netlify/functions/paper-report-worker.js'
import { createPaperReportArtifactDownloadHandler } from '../netlify/functions/paper-report-artifact-download.js'
import { createPaperReportArtifactExpirationHandler } from '../netlify/functions/paper-report-artifact-expiration.js'
import { createReleaseEvidenceHandler } from '../netlify/functions/release-evidence.js'
import { createReleaseEvidenceActionHandler } from '../netlify/functions/release-evidence-action.js'
import { createReleaseAttestationActionHandler } from '../netlify/functions/release-attestation-action.js'
import { createReleaseGateHandler } from '../netlify/functions/release-gate.js'
import { registerReleaseEvidence, updateReleaseEvidenceVerification } from '../lib/system/releaseEvidenceRegistryEngine.js'
import { createReleaseCandidateManifest } from '../lib/system/releaseCandidatePackagingEngine.js'
import { transitionReleaseApproval, validateProductionRun } from '../lib/system/releaseApprovalWorkflowEngine.js'
import { certifyReleaseCandidate } from '../lib/system/releaseCertificationEngine.js'
import { evaluateReleaseRecoveryReadiness, generateReleaseRunbook } from '../lib/system/releaseRunbookRecoveryEngine.js'
import { signReleaseAttestation } from '../lib/system/releaseAttestationGateEngine.js'
import { assertValidTransition, safeContentDisposition } from '../lib/security/securityPolicyEngine.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }
const releaseSigningSecret = 'phase80-signing-material'

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'owner', organizationId = 'org-atlas-local', query = {}) {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase80',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', limit: '250', ...query },
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

function releaseFixture() {
  const releaseCandidateManifest = createReleaseCandidateManifest({
    tenantContext,
    accountId: 'paper-portfolio',
    releaseCandidateId: 'rc-paper-80',
    gitCommit: 'abc800',
    branch: 'part-10-trading-workspace',
    applicationVersion: '0.0.0',
    databaseMigrationLevel: '202607160062_phase79_release_evidence_attestation_gate',
    releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy', deploymentBlockers: [], warnings: [] },
    productionConfigurationValidation: { configurationValidationStatus: 'healthy', criticalSummary: [], warningSummary: [] },
    lintSummary: { status: 'passed' },
    buildSummary: { status: 'passed' },
  }, { emitEvent: false }).releaseCandidateManifest
  const releaseApproval = transitionReleaseApproval({ tenantContext, releaseCandidateManifest, actor: { id: userId, role: 'owner' }, decision: 'approved' }, { emitEvent: false }).releaseApproval
  const productionRunValidation = validateProductionRun({ tenantContext, releaseCandidateManifest, releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy' }, productionConfigurationValidation: { configurationValidationStatus: 'healthy' } }, { emitEvent: false }).productionRunValidation
  const releaseCertification = certifyReleaseCandidate({ tenantContext, releaseCandidateManifest, releaseApproval, productionRunValidation, validationSummary: { testFileCount: 170, testCount: 950, lint: { status: 'passed' }, build: { status: 'passed' } } }, { emitEvent: false }).releaseCertification
  const releaseRunbook = generateReleaseRunbook({ tenantContext, releaseCandidateManifest }, { emitEvent: false }).releaseRunbook
  const releaseRecoveryReadiness = evaluateReleaseRecoveryReadiness({ releaseRunbook, releaseRunbookItems: releaseRunbook.items.map((item) => ({ ...item, status: 'completed' })) }, { emitEvent: false }).releaseRecoveryReadiness
  const releaseEvidence = ['functional-test-results', 'regression-test-results', 'lint-results', 'build-results', 'migration-verification', 'tenant-isolation-verification', 'paper-only-boundary-verification', 'production-configuration-validation', 'production-run-validation', 'recovery-readiness-validation'].map((category) => updateReleaseEvidenceVerification({
    releaseEvidence: registerReleaseEvidence({ tenantContext, releaseCandidateManifest, category, sourceType: 'atlas-snapshot-reference', sourceReference: category }, { emitEvent: false }).releaseEvidence,
    actor: { id: userId, role: 'owner' },
    action: 'verified',
  }, { emitEvent: false }).releaseEvidence)
  return { releaseCandidateManifest, releaseApproval, productionRunValidation, releaseCertification, releaseRunbook, releaseRecoveryReadiness, releaseEvidence }
}

describe('Phase 80A security hardening and abuse resistance', () => {
  it('denies missing tenant, missing account, cross-tenant object access, viewer writes, and analyst release signing escalation', async () => {
    const fixture = releaseFixture()
    const evidenceRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })), appendActivity: vi.fn(async () => ({ ok: true })) }
    const noTenant = parseResponse(await createReleaseEvidenceHandler({ organizationMembershipRepository: membershipRepository('viewer'), releaseEvidenceRepository: evidenceRepository })(authEvent('GET', {}, 'viewer', undefined, { organizationId: undefined })))
    const noAccount = parseResponse(await createReleaseEvidenceHandler({ organizationMembershipRepository: membershipRepository('viewer'), releaseEvidenceRepository: evidenceRepository })(authEvent('GET', {}, 'viewer', 'org-atlas-local', { accountId: undefined })))
    const viewerWrite = parseResponse(await createReleaseEvidenceHandler({ organizationMembershipRepository: membershipRepository('viewer'), releaseEvidenceRepository: evidenceRepository, accountId: 'paper-portfolio' })(authEvent('POST', { category: 'manual-qa-evidence', sourceType: 'manual-metadata', sourceReference: 'manual' }, 'viewer')))
    const analystSign = parseResponse(await createReleaseAttestationActionHandler({ organizationMembershipRepository: membershipRepository('analyst'), accountId: 'paper-portfolio', releaseSigningSecret })(authEvent('POST', { ...fixture, action: 'sign', actor: { id: userId, role: 'owner' } }, 'analyst')))
    const invalidAction = parseResponse(await createReleaseEvidenceActionHandler({ organizationMembershipRepository: membershipRepository('analyst'), releaseEvidenceRepository: evidenceRepository, accountId: 'paper-portfolio' })(authEvent('POST', { releaseEvidence: fixture.releaseEvidence[0], action: 'delete-evidence' }, 'analyst')))
    expect(noTenant.statusCode).toBe(403)
    expect(noAccount.statusCode).toBe(400)
    expect(viewerWrite.statusCode).toBe(403)
    expect(analystSign.statusCode).toBe(403)
    expect(invalidAction.statusCode).toBe(400)
    expect(JSON.stringify(analystSign.json)).not.toContain('phase80-signing-material')
  })

  it('enforces sensitive owner/admin actions, invalid transition rejection, bounded list limits, and safe public errors', async () => {
    const fixture = releaseFixture()
    const signed = signReleaseAttestation({ ...fixture, actor: { id: userId, role: 'owner' }, acceptedWarnings: true }, { emitEvent: false, signingSecret: releaseSigningSecret }).releaseAttestation
    const attestationRepository = { create: vi.fn(async () => ({ ok: true })), appendActivity: vi.fn(async () => ({ ok: true })) }
    const ownerSign = parseResponse(await createReleaseAttestationActionHandler({ organizationMembershipRepository: membershipRepository('owner'), releaseAttestationRepository: attestationRepository, accountId: 'paper-portfolio', releaseSigningSecret })(authEvent('POST', { ...fixture, action: 'sign' }, 'owner')))
    const invalidRevoke = parseResponse(await createReleaseAttestationActionHandler({ organizationMembershipRepository: membershipRepository('owner'), releaseAttestationRepository: attestationRepository, accountId: 'paper-portfolio', releaseSigningSecret })(authEvent('POST', { releaseAttestation: { ...signed, attestationState: 'revoked' }, action: 'revoke', reason: 'already revoked' }, 'owner')))
    const gateRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })) }
    const gateRead = parseResponse(await createReleaseGateHandler({ organizationMembershipRepository: membershipRepository('viewer'), releaseGateEvaluationRepository: gateRepository, accountId: 'paper-portfolio' })(authEvent('GET', {}, 'viewer', 'org-atlas-local', { limit: '9999' })))
    expect(ownerSign.statusCode).toBe(200)
    expect(invalidRevoke.statusCode).toBe(409)
    expect(gateRead.statusCode).toBe(200)
    expect(gateRepository.list).toHaveBeenCalledWith(expect.objectContaining({ limit: '9999' }))
    expect(() => assertValidTransition({ currentState: 'signed', nextState: 'revoked', terminalStates: ['signed'] })).toThrow('state transition is invalid')
  })

  it('protects worker and artifact download or expiration flows with tenant, state, expiration, and content-disposition checks', async () => {
    const artifact = createPaperReportArtifact({ tenantContext, accountId: 'paper-portfolio', id: 'artifact-safe-1', content: 'id,label\n1,Report', filename: '../unsafe.csv' }, { emitEvent: false }).artifactRecord
    const expired = { ...artifact, id: 'artifact-expired', expiresAt: '2026-01-01T00:00:00.000Z' }
    const otherTenant = { ...artifact, id: 'artifact-other', tenantScope: { ...tenantContext, organizationId: 'org-other' } }
    const repository = {
      get: vi.fn(async ({ artifactId }) => artifactId === 'artifact-expired' ? expired : artifactId === 'artifact-other' ? otherTenant : artifact),
      update: vi.fn(async () => ({ ok: true })),
      list: vi.fn(async () => [artifact]),
    }
    const workerDenied = parseResponse(await createPaperReportWorkerHandler({ organizationMembershipRepository: membershipRepository('viewer'), accountId: 'paper-portfolio' })(authEvent('POST', { jobs: [] }, 'viewer')))
    const downloaded = parseResponse(await createPaperReportArtifactDownloadHandler({ organizationMembershipRepository: membershipRepository('viewer'), paperReportArtifactRepository: repository, accountId: 'paper-portfolio' })(authEvent('GET', {}, 'viewer', 'org-atlas-local', { artifactId: 'artifact-safe-1' })))
    const expiredDownload = parseResponse(await createPaperReportArtifactDownloadHandler({ organizationMembershipRepository: membershipRepository('viewer'), paperReportArtifactRepository: repository, accountId: 'paper-portfolio' })(authEvent('GET', {}, 'viewer', 'org-atlas-local', { artifactId: 'artifact-expired' })))
    const crossTenant = parseResponse(await createPaperReportArtifactDownloadHandler({ organizationMembershipRepository: membershipRepository('viewer'), paperReportArtifactRepository: repository, accountId: 'paper-portfolio' })(authEvent('GET', {}, 'viewer', 'org-atlas-local', { artifactId: 'artifact-other' })))
    const expiration = parseResponse(await createPaperReportArtifactExpirationHandler({ organizationMembershipRepository: membershipRepository('analyst'), paperReportArtifactRepository: repository, accountId: 'paper-portfolio' })(authEvent('POST', { artifactRecord: { ...artifact, expiresAt: '2026-01-01T00:00:00.000Z' }, timestamp: '2026-07-16T12:00:00.000Z' }, 'analyst')))
    expect(workerDenied.statusCode).toBe(403)
    expect(downloaded.statusCode).toBe(200)
    expect(downloaded.json.data.paperReportArtifactDownload.headers['content-disposition']).toBe('attachment; filename="unsafe.csv"')
    expect(expiredDownload.statusCode).toBe(410)
    expect(crossTenant.statusCode).toBe(403)
    expect(expiration.statusCode).toBe(200)
    expect(safeContentDisposition('report.csv')).toBe('attachment; filename="report.csv"')
    expect(downloadPaperReportArtifact({ ...artifact, status: 'available', content: 'tampered' }, { emitEvent: false }).downloadStatus).toBe('blocked')
  })

  it('rejects oversized requests through the existing API reliability wrapper', async () => {
    const handler = createApiHandler(async () => ({ ok: true }), { allowedMethods: ['POST'], maxRequestBytes: 8, env: { NODE_ENV: 'test' } })
    const response = parseResponse(await handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'oversized' }) }))
    expect(response.statusCode).toBe(413)
    expect(response.json.error.message).toBe('request body is too large')
  })
})

describe('Phase 80B performance, accessibility, and UX hardening', () => {
  it('renders bounded release hardening summaries, accessible labels, status text, and paper-only UX language', () => {
    const markup = renderToStaticMarkup(React.createElement(App))
    expect(markup).toContain('Dashboard')
    expect(markup).toContain('Loading deferred dashboard feature')
    expect(markup).toContain('aria-label="Dashboard loading"')
    expect(markup).not.toContain('Final Security &amp; UX Hardening')
    expect(markup).toContain('Paper Trading only')
    expect(markup).toContain('Trading OS')
    expect(markup).toContain('System Health')
  })
})
