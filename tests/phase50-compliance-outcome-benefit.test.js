import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceImprovementOutcomeReviewRepository, reviewComplianceImprovementOutcomes, SYSTEM_COMPLIANCE_IMPROVEMENT_OUTCOME_REVIEWED_EVENT } from '../lib/system/complianceImprovementOutcomeReviewEngine.js'
import { createComplianceBenefitRealizationRepository, summarizeComplianceBenefitRealization, SYSTEM_COMPLIANCE_BENEFIT_REALIZATION_SUMMARIZED_EVENT } from '../lib/system/complianceBenefitRealizationEngine.js'
import { createComplianceImprovementOutcomeReviewsHandler } from '../netlify/functions/compliance-improvement-outcome-reviews.js'
import { createComplianceBenefitRealizationsHandler } from '../netlify/functions/compliance-benefit-realizations.js'

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
      'x-request-id': 'req-phase50ab',
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
  const complianceImprovementBacklog = { eventType: 'system.complianceImprovementBacklog.prioritized', backlogSummary: { averageBacklogScore: 92 } }
  const complianceAdoptionMonitoring = { eventType: 'system.complianceAdoptionMonitoring.evaluated', monitoringSummary: { averageMonitoringScore: 91 } }
  const complianceMaturityAssessment = { eventType: 'system.complianceMaturity.assessed', maturitySummary: { averageMaturityScore: 90 } }
  const complianceImprovementOutcomeReview = reviewComplianceImprovementOutcomes({ tenantContext, complianceAdoptionMonitoring, complianceImprovementBacklog }, { emitEvent: false })
  const complianceBenefitRealization = summarizeComplianceBenefitRealization({ tenantContext, complianceImprovementOutcomeReview, complianceMaturityAssessment }, { emitEvent: false })
  return { complianceImprovementBacklog, complianceAdoptionMonitoring, complianceMaturityAssessment, complianceImprovementOutcomeReview, complianceBenefitRealization }
}

describe('Phase 50A compliance improvement outcome review', () => {
  it('adds idempotent outcome/benefit migrations and parameterized outcome access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_improvement_outcome_reviews')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_benefit_realizations')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceImprovementOutcomeReviewRepository({ database: { connected: true, query } })
    await repository.create({ id: 'outcome-1', tenantContext, outcomeStatus: 'reviewed', outcomeScore: 92 })
    await repository.list({ tenantContext, outcomeStatus: 'reviewed' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('reviews outcomes without claims, closure, or remediation automation', () => {
    const source = upstream()
    expect(source.complianceImprovementOutcomeReview.eventType).toBe(SYSTEM_COMPLIANCE_IMPROVEMENT_OUTCOME_REVIEWED_EVENT)
    expect(source.complianceImprovementOutcomeReview.automaticOutcomeClaim).toBe(false)
    expect(source.complianceImprovementOutcomeReview.automaticClosure).toBe(false)
    expect(source.complianceImprovementOutcomeReview.automaticRemediation).toBe(false)
  })

  it('serves outcome APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceImprovementOutcomeReviewsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceImprovementOutcomeReviewsHandler(options)(authEvent('POST', { review: { id: 'outcome-1' } })))
    const denied = parseResponse(await createComplianceImprovementOutcomeReviewsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceImprovementOutcomeReview.automaticOutcomeClaim).toBe(false)
    expect(create.json.data.review.automaticClosure).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 50B compliance benefit realization', () => {
  it('summarizes benefit realization without benefit claims or distribution automation', async () => {
    const source = upstream()
    expect(source.complianceBenefitRealization.eventType).toBe(SYSTEM_COMPLIANCE_BENEFIT_REALIZATION_SUMMARIZED_EVENT)
    expect(source.complianceBenefitRealization.automaticBenefitClaim).toBe(false)
    expect(source.complianceBenefitRealization.automaticExecutiveDistribution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceBenefitRealizationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'benefit-1', tenantContext, benefitStatus: 'realized', benefitScore: 91 })
    await repository.list({ tenantContext, benefitStatus: 'realized' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves benefit realization APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceBenefitRealizationsHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceBenefitRealizationsHandler(options)(authEvent('POST', { benefit: { id: 'benefit-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceBenefitRealizationsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceBenefitRealization.automaticBenefitClaim).toBe(false)
    expect(create.json.data.benefit.automaticExecutiveDistribution).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceBenefitRealizationsHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
