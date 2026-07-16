import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createReleaseApprovalRepository, createProductionRunValidationRepository, transitionReleaseApproval, validateProductionRun } from '../lib/system/releaseApprovalWorkflowEngine.js'
import { createReleaseCandidateManifest, createReleaseCandidateManifestRepository, supersedeReleaseCandidate } from '../lib/system/releaseCandidatePackagingEngine.js'
import { createReleaseCandidatesHandler } from '../netlify/functions/release-candidates.js'
import { createReleaseApprovalActionHandler } from '../netlify/functions/release-approval-action.js'
import { createProductionRunValidationHandler } from '../netlify/functions/production-run-validation.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }

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
      'x-request-id': 'req-phase77',
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

function readiness(status = 'healthy') {
  return status === 'blocked'
    ? { releaseReadinessStatus: 'blocked', deploymentBlockers: [{ id: 'risk', message: 'Risk blocked.' }], warnings: [], timestamp: 'ready-ref' }
    : { releaseReadinessStatus: status, deploymentBlockers: [], warnings: status === 'warning' ? [{ id: 'api', message: 'API warning.' }] : [], timestamp: 'ready-ref' }
}

function config(status = 'healthy') {
  return status === 'blocked'
    ? { configurationValidationStatus: 'blocked', criticalSummary: [{ id: 'paper', message: 'Paper mode missing.' }], warningSummary: [], timestamp: 'config-ref' }
    : { configurationValidationStatus: status, criticalSummary: [], warningSummary: status === 'warning' ? [{ id: 'worker', message: 'Worker warning.' }] : [], timestamp: 'config-ref' }
}

function manifestInput(extra = {}) {
  return {
    tenantContext,
    accountId: 'paper-portfolio',
    releaseCandidateId: 'rc-paper-test',
    gitCommit: 'abc123',
    branch: 'part-10-trading-workspace',
    applicationVersion: '0.0.0',
    databaseMigrationLevel: '202607160060_phase77_release_candidate_approval_validation',
    releaseReadinessDiagnostics: readiness(),
    productionConfigurationValidation: config(),
    testSummaryReferences: ['npm test'],
    lintSummary: { status: 'passed' },
    buildSummary: { status: 'passed' },
    ...extra,
  }
}

describe('Phase 77A release-candidate packaging and manifest', () => {
  it('adds idempotent release-candidate persistence and parameterized repositories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_candidate_manifests')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_approvals')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_approval_activity')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_production_run_validations')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createReleaseCandidateManifestRepository, createReleaseApprovalRepository, createProductionRunValidationRepository]) {
      const query = vi.fn(async () => ({ rows: [{ payload: { ok: true } }] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ tenantScope: tenantContext, accountId: 'paper-portfolio', releaseCandidateId: 'rc', manifestState: 'validated', gitCommit: 'abc', applicationVersion: '0.0.0', checksum: 'fnv1a-1', approvalState: 'pending', actor: { id: userId }, validationState: 'passed' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('generates deterministic checksummed manifests, blocks critical candidates, and supersedes without mutating history', () => {
    const first = createReleaseCandidateManifest(manifestInput(), { emitEvent: false, timestamp: '2026-07-16T11:00:00.000Z' })
    const second = createReleaseCandidateManifest(manifestInput(), { emitEvent: false, timestamp: '2026-07-16T11:00:00.000Z' })
    const blocked = createReleaseCandidateManifest(manifestInput({ releaseReadinessDiagnostics: readiness('blocked'), manifestState: 'approved' }), { emitEvent: false })
    const superseded = supersedeReleaseCandidate(manifestInput({ releaseCandidateId: 'rc-paper-next', supersedesReleaseCandidateId: first.releaseCandidateManifest.releaseCandidateId }), { emitEvent: false })
    expect(first.releaseCandidateManifest.checksum).toBe(second.releaseCandidateManifest.checksum)
    expect(first.manifestState).toBe('validated')
    expect(blocked.manifestState).toBe('blocked')
    expect(blocked.approvalBlocked).toBe(true)
    expect(superseded.supersededReleaseCandidateId).toBe('rc-paper-test')
    expect(first.releaseCandidateManifest.checksum).toMatch(/^fnv1a-/)
  })
})

describe('Phase 77B deployment approval workflow and production run validation', () => {
  it('prevents duplicate, role-denied, blocked, and invalid approval transitions while appending activity', () => {
    const candidate = createReleaseCandidateManifest(manifestInput(), { emitEvent: false }).releaseCandidateManifest
    const approved = transitionReleaseApproval({ tenantContext, releaseCandidateManifest: candidate, actor: { id: userId, role: 'owner' }, decision: 'approved', note: 'safe approval' }, { emitEvent: false, timestamp: '2026-07-16T11:01:00.000Z' })
    const duplicate = transitionReleaseApproval({ tenantContext, releaseCandidateManifest: candidate, actor: { id: userId, role: 'owner' }, decision: 'pending', existingApprovals: [approved.releaseApproval] }, { emitEvent: false })
    const analyst = transitionReleaseApproval({ tenantContext: { ...tenantContext, role: 'analyst' }, releaseCandidateManifest: candidate, actor: { id: userId, role: 'analyst' }, decision: 'approved' }, { emitEvent: false })
    const invalid = transitionReleaseApproval({ tenantContext, releaseCandidateManifest: candidate, actor: { id: userId, role: 'owner' }, decision: 'approved', releaseApproval: { approvalState: 'revoked' } }, { emitEvent: false })
    expect(approved.approvalState).toBe('approved')
    expect(approved.approvalActivity.appendOnly).toBe(true)
    expect(duplicate.releaseApproval.blockedReason).toBe('duplicate_active_approval')
    expect(analyst.releaseApproval.blockedReason).toBe('role_not_permitted')
    expect(invalid.releaseApproval.blockedReason).toBe('invalid_transition')
  })

  it('validates externally deployed paper-only releases with pass, warning, and failure states', () => {
    const candidate = createReleaseCandidateManifest(manifestInput(), { emitEvent: false }).releaseCandidateManifest
    const pass = validateProductionRun({ tenantContext, releaseCandidateManifest: candidate, productionConfigurationValidation: config(), releaseReadinessDiagnostics: readiness(), marketDataScannerHealth: { healthStatus: 'healthy' } }, { emitEvent: false })
    const warn = validateProductionRun({ tenantContext, releaseCandidateManifest: { ...candidate, databaseMigrationLevel: 'unknown' }, productionConfigurationValidation: config(), releaseReadinessDiagnostics: readiness(), marketDataScannerHealth: { healthStatus: 'degraded' } }, { emitEvent: false })
    const fail = validateProductionRun({ tenantContext, releaseCandidateManifest: candidate, productionConfigurationValidation: config('blocked'), releaseReadinessDiagnostics: readiness('blocked') }, { emitEvent: false })
    expect(pass.validationState).toBe('passed')
    expect(warn.validationState).toBe('warning')
    expect(fail.validationState).toBe('failed')
    expect(fail.productionRunValidation.liveOrders).toBe(false)
  })

  it('serves protected release APIs with viewer read-only, owner actions, and cross-tenant denial', async () => {
    const candidate = createReleaseCandidateManifest(manifestInput(), { emitEvent: false }).releaseCandidateManifest
    const manifestRepository = { list: vi.fn(async () => [candidate]), create: vi.fn(async () => ({ ok: true })) }
    const approvalRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })), appendActivity: vi.fn(async () => ({ ok: true })) }
    const validationRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })) }
    const viewerOptions = { accountId: 'paper-portfolio', organizationMembershipRepository: membershipRepository('viewer'), releaseCandidateManifestRepository: manifestRepository, releaseApprovalRepository: approvalRepository, productionRunValidationRepository: validationRepository }
    const ownerOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('owner') }
    const read = parseResponse(await createReleaseCandidatesHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const createDenied = parseResponse(await createReleaseCandidatesHandler(viewerOptions)(authEvent('POST', manifestInput(), 'viewer')))
    const createAllowed = parseResponse(await createReleaseCandidatesHandler(ownerOptions)(authEvent('POST', manifestInput(), 'owner')))
    const approvalAllowed = parseResponse(await createReleaseApprovalActionHandler(ownerOptions)(authEvent('POST', { releaseCandidateManifest: candidate, action: 'approved' }, 'owner')))
    const validationAllowed = parseResponse(await createProductionRunValidationHandler(ownerOptions)(authEvent('POST', { releaseCandidateManifest: candidate, productionConfigurationValidation: config(), releaseReadinessDiagnostics: readiness() }, 'owner')))
    const crossTenant = parseResponse(await createReleaseCandidatesHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect(read.statusCode).toBe(200)
    expect(createDenied.statusCode).toBe(403)
    expect(createAllowed.statusCode).toBe(200)
    expect(approvalAllowed.statusCode).toBe(200)
    expect(validationAllowed.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
