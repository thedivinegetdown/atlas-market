import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceImprovementOpportunityRepository, identifyComplianceImprovementOpportunities, SYSTEM_COMPLIANCE_IMPROVEMENT_OPPORTUNITY_IDENTIFIED_EVENT } from '../lib/system/complianceImprovementOpportunityEngine.js'
import { createComplianceAdoptionReadinessRepository, evaluateComplianceAdoptionReadiness, SYSTEM_COMPLIANCE_ADOPTION_READINESS_EVALUATED_EVENT } from '../lib/system/complianceAdoptionReadinessEngine.js'
import { createComplianceImprovementOpportunitiesHandler } from '../netlify/functions/compliance-improvement-opportunities.js'
import { createComplianceAdoptionReadinessHandler } from '../netlify/functions/compliance-adoption-readiness.js'

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
      'x-request-id': 'req-phase48ab',
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
  const complianceLessonsLearned = { eventType: 'system.complianceLessonsLearned.captured', lessonSummary: { averageLessonScore: 92 } }
  const complianceChangeGovernanceSummary = { eventType: 'system.complianceChangeGovernance.summarized', governanceSummary: { averageGovernanceScore: 94 } }
  const complianceResourcePlanning = { eventType: 'system.complianceResourcePlanning.evaluated', resourceSummary: { averageResourceScore: 90 } }
  const complianceTrainingReadiness = { eventType: 'system.complianceTrainingReadiness.evaluated', trainingSummary: { averageTrainingScore: 91 } }
  const complianceImprovementOpportunity = identifyComplianceImprovementOpportunities({ tenantContext, complianceLessonsLearned, complianceChangeGovernanceSummary }, { emitEvent: false })
  const complianceAdoptionReadiness = evaluateComplianceAdoptionReadiness({ tenantContext, complianceImprovementOpportunity, complianceResourcePlanning, complianceTrainingReadiness }, { emitEvent: false })
  return { complianceLessonsLearned, complianceChangeGovernanceSummary, complianceResourcePlanning, complianceTrainingReadiness, complianceImprovementOpportunity, complianceAdoptionReadiness }
}

describe('Phase 48A compliance improvement opportunities', () => {
  it('adds idempotent improvement/adoption migrations and parameterized opportunity access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_improvement_opportunities')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_adoption_readiness')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceImprovementOpportunityRepository({ database: { connected: true, query } })
    await repository.create({ id: 'opportunity-1', tenantContext, opportunityStatus: 'identified', opportunityScore: 92 })
    await repository.list({ tenantContext, opportunityStatus: 'identified' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('identifies opportunities without remediation, assignment, or policy automation', () => {
    const source = upstream()
    expect(source.complianceImprovementOpportunity.eventType).toBe(SYSTEM_COMPLIANCE_IMPROVEMENT_OPPORTUNITY_IDENTIFIED_EVENT)
    expect(source.complianceImprovementOpportunity.automaticRemediation).toBe(false)
    expect(source.complianceImprovementOpportunity.automaticPolicyUpdate).toBe(false)
    expect(source.complianceImprovementOpportunity.automaticAssignment).toBe(false)
  })

  it('serves opportunity APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceImprovementOpportunitiesHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceImprovementOpportunitiesHandler(options)(authEvent('POST', { opportunity: { id: 'opportunity-1' } })))
    const denied = parseResponse(await createComplianceImprovementOpportunitiesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceImprovementOpportunity.automaticRemediation).toBe(false)
    expect(create.json.data.opportunity.automaticPolicyUpdate).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 48B compliance adoption readiness', () => {
  it('evaluates adoption readiness without automatic adoption or training assignment', async () => {
    const source = upstream()
    expect(source.complianceAdoptionReadiness.eventType).toBe(SYSTEM_COMPLIANCE_ADOPTION_READINESS_EVALUATED_EVENT)
    expect(source.complianceAdoptionReadiness.automaticAdoption).toBe(false)
    expect(source.complianceAdoptionReadiness.automaticTrainingAssignment).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceAdoptionReadinessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'adoption-1', tenantContext, adoptionStatus: 'ready', adoptionScore: 91 })
    await repository.list({ tenantContext, adoptionStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves adoption readiness APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceAdoptionReadinessHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceAdoptionReadinessHandler(options)(authEvent('POST', { readiness: { id: 'adoption-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceAdoptionReadinessHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceAdoptionReadiness.automaticAdoption).toBe(false)
    expect(create.json.data.readiness.automaticRemediation).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceAdoptionReadinessHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
