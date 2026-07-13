import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceStrategicOutcomeReviewRepository, reviewComplianceStrategicOutcomes, SYSTEM_COMPLIANCE_STRATEGIC_OUTCOME_REVIEWED_EVENT } from '../lib/system/complianceStrategicOutcomeReviewEngine.js'
import { createComplianceStrategicLearningSummaryRepository, captureComplianceStrategicLearningSummary, SYSTEM_COMPLIANCE_STRATEGIC_LEARNING_SUMMARY_CAPTURED_EVENT } from '../lib/system/complianceStrategicLearningSummaryEngine.js'
import { createComplianceStrategicOutcomeReviewsHandler } from '../netlify/functions/compliance-strategic-outcome-reviews.js'
import { createComplianceStrategicLearningSummariesHandler } from '../netlify/functions/compliance-strategic-learning-summaries.js'

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
      'x-request-id': 'req-phase57ab',
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
  const complianceStrategicAdaptationReadiness = { eventType: 'system.complianceStrategicAdaptationReadiness.evaluated', strategicAdaptationSummary: { averageAdaptationScore: 93 } }
  const complianceStrategicRefinementBacklog = { eventType: 'system.complianceStrategicRefinementBacklog.prioritized', strategicRefinementSummary: { averageRefinementScore: 92 } }
  const complianceStrategicCommunicationEffectiveness = { eventType: 'system.complianceStrategicCommunicationEffectiveness.reviewed', communicationEffectivenessSummary: { averageEffectivenessScore: 91 } }
  const complianceStrategicFeedbackIntake = { eventType: 'system.complianceStrategicFeedbackIntake.evaluated', strategicFeedbackSummary: { averageFeedbackScore: 90 } }
  const complianceStrategicOutcomeReview = reviewComplianceStrategicOutcomes({
    tenantContext,
    complianceStrategicAdaptationReadiness,
    complianceStrategicRefinementBacklog,
    complianceStrategicCommunicationEffectiveness,
  }, { emitEvent: false })
  const complianceStrategicLearningSummary = captureComplianceStrategicLearningSummary({
    tenantContext,
    complianceStrategicOutcomeReview,
    complianceStrategicAdaptationReadiness,
    complianceStrategicFeedbackIntake,
  }, { emitEvent: false })
  return {
    complianceStrategicAdaptationReadiness,
    complianceStrategicRefinementBacklog,
    complianceStrategicCommunicationEffectiveness,
    complianceStrategicFeedbackIntake,
    complianceStrategicOutcomeReview,
    complianceStrategicLearningSummary,
  }
}

describe('Phase 57A compliance strategic outcome review', () => {
  it('adds idempotent strategic learning migrations and parameterized outcome access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_outcome_reviews')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_learning_summaries')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicOutcomeReviewRepository({ database: { connected: true, query } })
    await repository.create({ id: 'outcome-1', tenantContext, outcomeStatus: 'validated', outcomeScore: 92 })
    await repository.list({ tenantContext, outcomeStatus: 'validated' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('reviews strategic outcomes without outcome claims, strategy changes, or approval automation', () => {
    const source = upstream()
    expect(source.complianceStrategicOutcomeReview.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_OUTCOME_REVIEWED_EVENT)
    expect(source.complianceStrategicOutcomeReview.automaticOutcomeClaim).toBe(false)
    expect(source.complianceStrategicOutcomeReview.automaticStrategyChange).toBe(false)
    expect(source.complianceStrategicOutcomeReview.automaticApproval).toBe(false)
  })

  it('serves strategic outcome APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicOutcomeReviewsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceStrategicOutcomeReviewsHandler(options)(authEvent('POST', { outcome: { id: 'outcome-1' } })))
    const denied = parseResponse(await createComplianceStrategicOutcomeReviewsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicOutcomeReview.automaticOutcomeClaim).toBe(false)
    expect(create.json.data.outcome.automaticStrategyChange).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 57B compliance strategic learning summary', () => {
  it('captures strategic learning without learning claims, policy updates, or strategy changes', async () => {
    const source = upstream()
    expect(source.complianceStrategicLearningSummary.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_LEARNING_SUMMARY_CAPTURED_EVENT)
    expect(source.complianceStrategicLearningSummary.automaticLearningClaim).toBe(false)
    expect(source.complianceStrategicLearningSummary.automaticPolicyUpdate).toBe(false)
    expect(source.complianceStrategicLearningSummary.automaticStrategyChange).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicLearningSummaryRepository({ database: { connected: true, query } })
    await repository.create({ id: 'learning-1', tenantContext, learningStatus: 'captured', learningScore: 92 })
    await repository.list({ tenantContext, learningStatus: 'captured' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves strategic learning APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicLearningSummariesHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceStrategicLearningSummariesHandler(options)(authEvent('POST', { learning: { id: 'learning-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceStrategicLearningSummariesHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicLearningSummary.automaticLearningClaim).toBe(false)
    expect(create.json.data.learning.automaticPolicyUpdate).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceStrategicLearningSummariesHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
