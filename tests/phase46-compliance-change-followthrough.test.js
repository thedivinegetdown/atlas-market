import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceImplementationProgressRepository, trackComplianceImplementationProgress, SYSTEM_COMPLIANCE_IMPLEMENTATION_PROGRESS_TRACKED_EVENT } from '../lib/system/complianceImplementationProgressEngine.js'
import { createComplianceChangeVerificationRepository, reviewComplianceChangeVerification, SYSTEM_COMPLIANCE_CHANGE_VERIFICATION_REVIEWED_EVENT } from '../lib/system/complianceChangeVerificationEngine.js'
import { createComplianceChangeClosureReadinessRepository, prepareComplianceChangeClosureReadiness, SYSTEM_COMPLIANCE_CHANGE_CLOSURE_PREPARED_EVENT } from '../lib/system/complianceChangeClosureReadinessEngine.js'
import { createComplianceImplementationProgressHandler } from '../netlify/functions/compliance-implementation-progress.js'
import { createComplianceChangeVerificationHandler } from '../netlify/functions/compliance-change-verification.js'
import { createComplianceChangeClosureReadinessHandler } from '../netlify/functions/compliance-change-closure-readiness.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'owner') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase46abc',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'owner') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function upstream() {
  const complianceImplementationPlanning = { eventType: 'system.complianceImplementationPlan.prepared', implementationSummary: { averageImplementationScore: 90 } }
  const complianceGovernanceActionItems = { eventType: 'system.complianceActionItems.tracked', actionItemSummary: { highPriority: 0 } }
  const complianceEvidenceRequestQueue = { eventType: 'system.complianceEvidenceRequest.queued', evidenceRequestSummary: { open: 0 } }
  const complianceChangeImpactAssessment = { eventType: 'system.complianceChangeImpact.assessed', impactSummary: { averageImpactScore: 45 } }
  const complianceImplementationProgress = trackComplianceImplementationProgress({ tenantContext, complianceImplementationPlanning, complianceGovernanceActionItems }, { emitEvent: false })
  const complianceChangeVerification = reviewComplianceChangeVerification({ tenantContext, complianceImplementationProgress, complianceEvidenceRequestQueue }, { emitEvent: false })
  const complianceChangeClosureReadiness = prepareComplianceChangeClosureReadiness({ tenantContext, complianceChangeVerification, complianceChangeImpactAssessment }, { emitEvent: false })
  return { complianceImplementationPlanning, complianceGovernanceActionItems, complianceEvidenceRequestQueue, complianceChangeImpactAssessment, complianceImplementationProgress, complianceChangeVerification, complianceChangeClosureReadiness }
}

describe('Phase 46A compliance implementation progress', () => {
  it('adds idempotent change followthrough migrations and parameterized progress access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_implementation_progress')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_change_verifications')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_change_closure_readiness')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceImplementationProgressRepository({ database: { connected: true, query } })
    await repository.create({ id: 'progress-1', tenantContext, progressStatus: 'on-track', progressScore: 90 })
    await repository.list({ tenantContext, progressStatus: 'on-track' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('tracks progress without implementation or status automation', () => {
    const source = upstream()
    expect(source.complianceImplementationProgress.eventType).toBe(SYSTEM_COMPLIANCE_IMPLEMENTATION_PROGRESS_TRACKED_EVENT)
    expect(source.complianceImplementationProgress.automaticImplementation).toBe(false)
    expect(source.complianceImplementationProgress.automaticStatusChange).toBe(false)
  })
})

describe('Phase 46B compliance change verification', () => {
  it('reviews verification without automatic approval', async () => {
    const source = upstream()
    expect(source.complianceChangeVerification.eventType).toBe(SYSTEM_COMPLIANCE_CHANGE_VERIFICATION_REVIEWED_EVENT)
    expect(source.complianceChangeVerification.automaticVerification).toBe(false)
    expect(source.complianceChangeVerification.automaticApproval).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceChangeVerificationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'verification-1', tenantContext, verificationStatus: 'verified', verificationScore: 92 })
    await repository.list({ tenantContext, verificationStatus: 'verified' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves progress and verification APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const progress = parseResponse(await createComplianceImplementationProgressHandler(options)(authEvent('GET')))
    const createProgress = parseResponse(await createComplianceImplementationProgressHandler(options)(authEvent('POST', { progress: { id: 'progress-1' } })))
    const verification = parseResponse(await createComplianceChangeVerificationHandler(options)(authEvent('GET')))
    const createVerification = parseResponse(await createComplianceChangeVerificationHandler(options)(authEvent('POST', { verification: { id: 'verification-1' } })))
    const denied = parseResponse(await createComplianceChangeVerificationHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([progress.statusCode, createProgress.statusCode, verification.statusCode, createVerification.statusCode]).toEqual([200, 200, 200, 200])
    expect(progress.json.data.complianceImplementationProgress.automaticStatusChange).toBe(false)
    expect(verification.json.data.complianceChangeVerification.automaticApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 46C compliance change closure readiness', () => {
  it('prepares closure readiness without automatic closure', async () => {
    const source = upstream()
    expect(source.complianceChangeClosureReadiness.eventType).toBe(SYSTEM_COMPLIANCE_CHANGE_CLOSURE_PREPARED_EVENT)
    expect(source.complianceChangeClosureReadiness.automaticClosure).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceChangeClosureReadinessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'closure-1', tenantContext, closureStatus: 'ready', closureScore: 90 })
    await repository.list({ tenantContext, closureStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves closure APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const closure = parseResponse(await createComplianceChangeClosureReadinessHandler(options)(authEvent('GET')))
    const createClosure = parseResponse(await createComplianceChangeClosureReadinessHandler(options)(authEvent('POST', { closure: { id: 'closure-1' } })))
    const denied = parseResponse(await createComplianceChangeClosureReadinessHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([closure.statusCode, createClosure.statusCode]).toEqual([200, 200])
    expect(closure.json.data.complianceChangeClosureReadiness.automaticClosure).toBe(false)
    expect(closure.json.data.complianceChangeClosureReadiness.automaticApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(closure.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
