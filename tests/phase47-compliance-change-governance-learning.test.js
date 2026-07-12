import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createCompliancePostImplementationReviewRepository, reviewCompliancePostImplementation, SYSTEM_COMPLIANCE_POST_IMPLEMENTATION_REVIEWED_EVENT } from '../lib/system/compliancePostImplementationReviewEngine.js'
import { captureComplianceLessonsLearned, createComplianceLessonsLearnedRepository, SYSTEM_COMPLIANCE_LESSONS_LEARNED_CAPTURED_EVENT } from '../lib/system/complianceLessonsLearnedEngine.js'
import { createComplianceChangeGovernanceSummaryRepository, summarizeComplianceChangeGovernance, SYSTEM_COMPLIANCE_CHANGE_GOVERNANCE_SUMMARIZED_EVENT } from '../lib/system/complianceChangeGovernanceSummaryEngine.js'
import { createCompliancePostImplementationReviewsHandler } from '../netlify/functions/compliance-post-implementation-reviews.js'
import { createComplianceLessonsLearnedHandler } from '../netlify/functions/compliance-lessons-learned.js'
import { createComplianceChangeGovernanceSummariesHandler } from '../netlify/functions/compliance-change-governance-summaries.js'

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
      'x-request-id': 'req-phase47abc',
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
  const complianceChangeClosureReadiness = { eventType: 'system.complianceChangeClosure.prepared', closureSummary: { averageClosureScore: 92 } }
  const complianceChangeVerification = { eventType: 'system.complianceChangeVerification.reviewed', verificationSummary: { averageVerificationScore: 92 } }
  const complianceProgramHealth = { eventType: 'system.complianceProgramHealth.evaluated', programHealthSummary: { averageScore: 92 } }
  const complianceGovernanceDecisionLog = { eventType: 'system.complianceGovernanceDecision.recorded', decisionLogStatus: 'ready' }
  const compliancePostImplementationReview = reviewCompliancePostImplementation({ tenantContext, complianceChangeClosureReadiness, complianceChangeVerification }, { emitEvent: false })
  const complianceLessonsLearned = captureComplianceLessonsLearned({ tenantContext, compliancePostImplementationReview, complianceProgramHealth }, { emitEvent: false })
  const complianceChangeGovernanceSummary = summarizeComplianceChangeGovernance({ tenantContext, complianceLessonsLearned, complianceGovernanceDecisionLog, complianceChangeClosureReadiness }, { emitEvent: false })
  return { complianceChangeClosureReadiness, complianceChangeVerification, complianceProgramHealth, complianceGovernanceDecisionLog, compliancePostImplementationReview, complianceLessonsLearned, complianceChangeGovernanceSummary }
}

describe('Phase 47A compliance post-implementation review', () => {
  it('adds idempotent governance learning migrations and parameterized review access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_post_implementation_reviews')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_lessons_learned')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_change_governance_summaries')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createCompliancePostImplementationReviewRepository({ database: { connected: true, query } })
    await repository.create({ id: 'review-1', tenantContext, reviewStatus: 'effective', reviewScore: 92 })
    await repository.list({ tenantContext, reviewStatus: 'effective' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('reviews post-implementation posture without claims or approvals', () => {
    const source = upstream()
    expect(source.compliancePostImplementationReview.eventType).toBe(SYSTEM_COMPLIANCE_POST_IMPLEMENTATION_REVIEWED_EVENT)
    expect(source.compliancePostImplementationReview.automaticEffectivenessClaim).toBe(false)
    expect(source.compliancePostImplementationReview.automaticApproval).toBe(false)
  })
})

describe('Phase 47B compliance lessons learned', () => {
  it('captures lessons without policy or training automation', async () => {
    const source = upstream()
    expect(source.complianceLessonsLearned.eventType).toBe(SYSTEM_COMPLIANCE_LESSONS_LEARNED_CAPTURED_EVENT)
    expect(source.complianceLessonsLearned.automaticPolicyUpdate).toBe(false)
    expect(source.complianceLessonsLearned.automaticTrainingAssignment).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceLessonsLearnedRepository({ database: { connected: true, query } })
    await repository.create({ id: 'lesson-1', tenantContext, lessonStatus: 'captured', lessonScore: 90 })
    await repository.list({ tenantContext, lessonStatus: 'captured' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves review and lessons APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const review = parseResponse(await createCompliancePostImplementationReviewsHandler(options)(authEvent('GET')))
    const createReview = parseResponse(await createCompliancePostImplementationReviewsHandler(options)(authEvent('POST', { review: { id: 'review-1' } })))
    const lessons = parseResponse(await createComplianceLessonsLearnedHandler(options)(authEvent('GET')))
    const createLesson = parseResponse(await createComplianceLessonsLearnedHandler(options)(authEvent('POST', { lesson: { id: 'lesson-1' } })))
    const denied = parseResponse(await createComplianceLessonsLearnedHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([review.statusCode, createReview.statusCode, lessons.statusCode, createLesson.statusCode]).toEqual([200, 200, 200, 200])
    expect(review.json.data.compliancePostImplementationReview.automaticEffectivenessClaim).toBe(false)
    expect(lessons.json.data.complianceLessonsLearned.automaticPolicyUpdate).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 47C compliance change governance summary', () => {
  it('summarizes change governance without decisions or approvals', async () => {
    const source = upstream()
    expect(source.complianceChangeGovernanceSummary.eventType).toBe(SYSTEM_COMPLIANCE_CHANGE_GOVERNANCE_SUMMARIZED_EVENT)
    expect(source.complianceChangeGovernanceSummary.automaticGovernanceDecision).toBe(false)
    expect(source.complianceChangeGovernanceSummary.automaticApproval).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceChangeGovernanceSummaryRepository({ database: { connected: true, query } })
    await repository.create({ id: 'governance-1', tenantContext, governanceStatus: 'ready', governanceScore: 92 })
    await repository.list({ tenantContext, governanceStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves governance summary APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const governance = parseResponse(await createComplianceChangeGovernanceSummariesHandler(options)(authEvent('GET')))
    const createGovernance = parseResponse(await createComplianceChangeGovernanceSummariesHandler(options)(authEvent('POST', { summary: { id: 'governance-1' } })))
    const denied = parseResponse(await createComplianceChangeGovernanceSummariesHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([governance.statusCode, createGovernance.statusCode]).toEqual([200, 200])
    expect(governance.json.data.complianceChangeGovernanceSummary.automaticGovernanceDecision).toBe(false)
    expect(governance.json.data.complianceChangeGovernanceSummary.automaticApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(governance.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
