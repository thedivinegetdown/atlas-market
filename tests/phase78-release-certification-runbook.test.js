import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { certifyReleaseCandidate, createReleaseCertificationRepository, supersedeReleaseCertification } from '../lib/system/releaseCertificationEngine.js'
import { createReleaseCandidateManifest } from '../lib/system/releaseCandidatePackagingEngine.js'
import { createReleaseApprovalRepository, createProductionRunValidationRepository, transitionReleaseApproval, validateProductionRun } from '../lib/system/releaseApprovalWorkflowEngine.js'
import { createReleaseRunbookRepository, evaluateReleaseRecoveryReadiness, generateReleaseRunbook, updateReleaseRunbookItem } from '../lib/system/releaseRunbookRecoveryEngine.js'
import { createReleaseCertificationsHandler } from '../netlify/functions/release-certifications.js'
import { createReleaseRunbooksHandler } from '../netlify/functions/release-runbooks.js'
import { createReleaseRunbookActionHandler } from '../netlify/functions/release-runbook-action.js'
import { createReleaseRecoveryReadinessHandler } from '../netlify/functions/release-recovery-readiness.js'

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
      'x-request-id': 'req-phase78',
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

function manifest() {
  return createReleaseCandidateManifest({
    tenantContext,
    accountId: 'paper-portfolio',
    releaseCandidateId: 'rc-paper-78',
    gitCommit: 'abc789',
    branch: 'part-10-trading-workspace',
    applicationVersion: '0.0.0',
    databaseMigrationLevel: '202607160061_phase78_release_certification_runbook',
    releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy', deploymentBlockers: [], warnings: [] },
    productionConfigurationValidation: { configurationValidationStatus: 'healthy', criticalSummary: [], warningSummary: [] },
    buildSummary: { status: 'passed' },
    lintSummary: { status: 'passed' },
  }, { emitEvent: false }).releaseCandidateManifest
}

function approvedCandidate() {
  const releaseCandidateManifest = manifest()
  const releaseApproval = transitionReleaseApproval({ tenantContext, releaseCandidateManifest, actor: { id: userId, role: 'owner' }, decision: 'approved' }, { emitEvent: false }).releaseApproval
  const productionRunValidation = validateProductionRun({ tenantContext, releaseCandidateManifest, productionConfigurationValidation: { configurationValidationStatus: 'healthy' }, releaseReadinessDiagnostics: { releaseReadinessStatus: 'healthy' } }, { emitEvent: false }).productionRunValidation
  return { releaseCandidateManifest, releaseApproval, productionRunValidation }
}

describe('Phase 78A release candidate QA certification', () => {
  it('adds idempotent certification and runbook persistence with parameterized repositories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_qa_certifications')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_runbooks')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_runbook_items')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_release_runbook_activity')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    for (const factory of [createReleaseCertificationRepository, createReleaseRunbookRepository, createReleaseApprovalRepository, createProductionRunValidationRepository]) {
      const query = vi.fn(async () => ({ rows: [{ payload: { ok: true } }] }))
      const repository = factory({ database: { connected: true, query } })
      await repository.create({ tenantScope: tenantContext, accountId: 'paper-portfolio', releaseCandidateId: 'rc', certificationState: 'passed', certificationScore: 100, runbookVersion: 'v1', recoveryReadinessState: 'ready', approvalState: 'approved', actor: { id: userId }, validationState: 'passed' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 10 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('requires an approved non-blocked candidate and produces passed, warning, failed, and superseded certification states', () => {
    const fixtures = approvedCandidate()
    const passed = certifyReleaseCandidate({ tenantContext, ...fixtures, validationSummary: { testFileCount: 167, testCount: 930, lint: { status: 'passed' }, build: { status: 'passed' } } }, { emitEvent: false })
    const warning = certifyReleaseCandidate({ tenantContext, ...fixtures, apiReliability: { apiReliabilityStatus: 'degraded' } }, { emitEvent: false })
    const failed = certifyReleaseCandidate({ tenantContext, releaseCandidateManifest: { ...fixtures.releaseCandidateManifest, manifestState: 'blocked' }, releaseApproval: fixtures.releaseApproval, productionRunValidation: fixtures.productionRunValidation }, { emitEvent: false })
    const superseded = supersedeReleaseCertification({ tenantContext, ...fixtures, supersedesCertificationId: passed.releaseCertification.id }, { emitEvent: false })
    expect(passed.certificationState).toBe('passed')
    expect(passed.certificationScore).toBe(100)
    expect(warning.certificationState).toBe('warning')
    expect(failed.certificationState).toBe('failed')
    expect(superseded.certificationState).toBe('superseded')
  })
})

describe('Phase 78B release runbook, checklist, and recovery readiness', () => {
  it('generates required checklist items and enforces notes, role permissions, append-only activity, and recovery readiness', () => {
    const releaseCandidateManifest = manifest()
    const runbook = generateReleaseRunbook({ tenantContext, releaseCandidateManifest }, { emitEvent: false })
    const analystItem = runbook.releaseRunbookItems.find((item) => item.requiredRole === 'analyst')
    const ownerItem = runbook.releaseRunbookItems.find((item) => item.requiredRole === 'owner')
    const completed = updateReleaseRunbookItem({ runbookItem: analystItem, actor: { id: userId, role: 'analyst' }, status: 'completed' }, { emitEvent: false })
    const denied = updateReleaseRunbookItem({ runbookItem: ownerItem, actor: { id: userId, role: 'analyst' }, status: 'completed' }, { emitEvent: false })
    const missingNote = updateReleaseRunbookItem({ runbookItem: ownerItem, actor: { id: userId, role: 'owner' }, status: 'skipped' }, { emitEvent: false })
    const skipped = updateReleaseRunbookItem({ runbookItem: ownerItem, actor: { id: userId, role: 'owner' }, status: 'skipped', note: 'Forward recovery documented.' }, { emitEvent: false })
    const readyItems = runbook.releaseRunbookItems.map((item) => ({ ...item, status: 'completed', completedAt: '2026-07-16T11:00:00.000Z' }))
    const ready = evaluateReleaseRecoveryReadiness({ releaseRunbook: runbook.releaseRunbook, releaseRunbookItems: readyItems }, { emitEvent: false })
    const blocked = evaluateReleaseRecoveryReadiness({ releaseRunbook: runbook.releaseRunbook, releaseRunbookItems: readyItems.filter((item) => item.category !== 'database-recovery') }, { emitEvent: false })
    expect(runbook.releaseRunbookItems.length).toBeGreaterThan(10)
    expect(completed.validTransition).toBe(true)
    expect(denied.runbookItem.blockedReason).toBe('role_not_permitted')
    expect(missingNote.runbookItem.blockedReason).toBe('required_note_missing')
    expect(skipped.validTransition).toBe(true)
    expect(skipped.runbookActivity.appendOnly).toBe(true)
    expect(ready.recoveryReadinessState).toBe('ready')
    expect(blocked.recoveryReadinessState).toBe('blocked')
  })

  it('serves protected certification and runbook APIs with viewer read-only, analyst item updates, owner generation, and cross-tenant denial', async () => {
    const fixtures = approvedCandidate()
    const runbook = generateReleaseRunbook({ tenantContext, releaseCandidateManifest: fixtures.releaseCandidateManifest }, { emitEvent: false })
    const certificationRepository = { list: vi.fn(async () => []), create: vi.fn(async () => ({ ok: true })) }
    const runbookRepository = { list: vi.fn(async () => [runbook.releaseRunbook]), create: vi.fn(async () => ({ ok: true })), createItem: vi.fn(async () => ({ ok: true })), appendActivity: vi.fn(async () => ({ ok: true })) }
    const viewerOptions = { accountId: 'paper-portfolio', organizationMembershipRepository: membershipRepository('viewer'), releaseCertificationRepository: certificationRepository, releaseRunbookRepository: runbookRepository }
    const analystOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') }
    const ownerOptions = { ...viewerOptions, organizationMembershipRepository: membershipRepository('owner') }
    const certRead = parseResponse(await createReleaseCertificationsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const certWrite = parseResponse(await createReleaseCertificationsHandler(analystOptions)(authEvent('POST', fixtures, 'analyst')))
    const runbookDenied = parseResponse(await createReleaseRunbooksHandler(viewerOptions)(authEvent('POST', { releaseCandidateManifest: fixtures.releaseCandidateManifest }, 'viewer')))
    const runbookWrite = parseResponse(await createReleaseRunbooksHandler(ownerOptions)(authEvent('POST', { releaseCandidateManifest: fixtures.releaseCandidateManifest }, 'owner')))
    const itemWrite = parseResponse(await createReleaseRunbookActionHandler(analystOptions)(authEvent('POST', { runbookItem: runbook.releaseRunbookItems.find((item) => item.requiredRole === 'analyst'), status: 'completed' }, 'analyst')))
    const recoveryRead = parseResponse(await createReleaseRecoveryReadinessHandler(viewerOptions)(authEvent('GET', { releaseRunbook: runbook.releaseRunbook, releaseRunbookItems: runbook.releaseRunbookItems }, 'viewer')))
    const crossTenant = parseResponse(await createReleaseCertificationsHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect(certRead.statusCode).toBe(200)
    expect(certWrite.statusCode).toBe(200)
    expect(runbookDenied.statusCode).toBe(403)
    expect(runbookWrite.statusCode).toBe(200)
    expect(itemWrite.statusCode).toBe(200)
    expect(recoveryRead.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
  })
})
