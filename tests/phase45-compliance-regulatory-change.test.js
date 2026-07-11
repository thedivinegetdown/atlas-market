import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateComplianceResourcePlanning } from '../lib/system/complianceResourcePlanningEngine.js'
import { evaluateComplianceContinuityReadiness } from '../lib/system/complianceContinuityReadinessEngine.js'
import { createComplianceRegulatoryChangeIntakeRepository, evaluateComplianceRegulatoryChangeIntake, SYSTEM_COMPLIANCE_REGULATORY_CHANGE_INTAKE_EVALUATED_EVENT } from '../lib/system/complianceRegulatoryChangeIntakeEngine.js'
import { assessComplianceChangeImpact, createComplianceChangeImpactAssessmentRepository, SYSTEM_COMPLIANCE_CHANGE_IMPACT_ASSESSED_EVENT } from '../lib/system/complianceChangeImpactAssessmentEngine.js'
import { createComplianceImplementationPlanningRepository, prepareComplianceImplementationPlan, SYSTEM_COMPLIANCE_IMPLEMENTATION_PLAN_PREPARED_EVENT } from '../lib/system/complianceImplementationPlanningEngine.js'
import { createComplianceRegulatoryChangeIntakeHandler } from '../netlify/functions/compliance-regulatory-change-intake.js'
import { createComplianceChangeImpactAssessmentsHandler } from '../netlify/functions/compliance-change-impact-assessments.js'
import { createComplianceImplementationPlansHandler } from '../netlify/functions/compliance-implementation-plans.js'

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
      'x-request-id': 'req-phase45abc',
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
  const complianceResourcePlanning = evaluateComplianceResourcePlanning({
    tenantContext,
    complianceScenarioPlanning: { eventType: 'system.complianceScenarioPlanning.evaluated', scenarioSummary: { averageScenarioScore: 90 } },
    complianceGovernanceActionItems: { eventType: 'system.complianceActionItems.tracked', actionItemSummary: { highPriority: 0 } },
  }, { emitEvent: false })
  const complianceContinuityReadiness = evaluateComplianceContinuityReadiness({
    tenantContext,
    complianceTrainingReadiness: { eventType: 'system.complianceTrainingReadiness.evaluated', trainingSummary: { averageTrainingScore: 92 } },
    complianceThirdPartyOversight: { eventType: 'system.complianceThirdPartyOversight.evaluated', oversightSummary: { averageOversightScore: 92 } },
    productionOperationsRunbook: { eventType: 'system.operationsRunbook.generated', operatorHandoffSummary: { handoffStatus: 'ready' } },
  }, { emitEvent: false })
  const policyControlPlanning = { eventType: 'system.policyControl.planned', policyReadinessStatus: 'ready' }
  const complianceObligationMapping = { eventType: 'system.complianceObligationMapping.evaluated', obligationSummary: { mapped: 3 } }
  const complianceRegulatoryChangeIntake = evaluateComplianceRegulatoryChangeIntake({ tenantContext, complianceContinuityReadiness, policyControlPlanning }, { emitEvent: false })
  const complianceChangeImpactAssessment = assessComplianceChangeImpact({ tenantContext, complianceRegulatoryChangeIntake, complianceObligationMapping }, { emitEvent: false })
  const complianceImplementationPlanning = prepareComplianceImplementationPlan({ tenantContext, complianceChangeImpactAssessment, complianceResourcePlanning, complianceContinuityReadiness }, { emitEvent: false })
  return { complianceResourcePlanning, complianceContinuityReadiness, policyControlPlanning, complianceObligationMapping, complianceRegulatoryChangeIntake, complianceChangeImpactAssessment, complianceImplementationPlanning }
}

describe('Phase 45A compliance regulatory change intake', () => {
  it('adds idempotent regulatory change migrations and parameterized intake access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_regulatory_change_intake')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_change_impact_assessments')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_implementation_plans')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceRegulatoryChangeIntakeRepository({ database: { connected: true, query } })
    await repository.create({ id: 'change-1', tenantContext, changeStatus: 'tracked', changePriorityScore: 20 })
    await repository.list({ tenantContext, changeStatus: 'tracked' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates regulatory changes without regulatory claims or policy updates', () => {
    const source = upstream()
    expect(source.complianceRegulatoryChangeIntake.eventType).toBe(SYSTEM_COMPLIANCE_REGULATORY_CHANGE_INTAKE_EVALUATED_EVENT)
    expect(source.complianceRegulatoryChangeIntake.automaticRegulatoryClaims).toBe(false)
    expect(source.complianceRegulatoryChangeIntake.automaticPolicyUpdate).toBe(false)
  })
})

describe('Phase 45B compliance change impact assessment', () => {
  it('assesses change impact without policy automation', async () => {
    const source = upstream()
    expect(source.complianceChangeImpactAssessment.eventType).toBe(SYSTEM_COMPLIANCE_CHANGE_IMPACT_ASSESSED_EVENT)
    expect(source.complianceChangeImpactAssessment.automaticPolicyUpdate).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceChangeImpactAssessmentRepository({ database: { connected: true, query } })
    await repository.create({ id: 'impact-1', tenantContext, impactStatus: 'moderate', impactScore: 45 })
    await repository.list({ tenantContext, impactStatus: 'moderate' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves intake and impact APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const intake = parseResponse(await createComplianceRegulatoryChangeIntakeHandler(options)(authEvent('GET')))
    const createIntake = parseResponse(await createComplianceRegulatoryChangeIntakeHandler(options)(authEvent('POST', { change: { id: 'change-1' } })))
    const impact = parseResponse(await createComplianceChangeImpactAssessmentsHandler(options)(authEvent('GET')))
    const createImpact = parseResponse(await createComplianceChangeImpactAssessmentsHandler(options)(authEvent('POST', { assessment: { id: 'impact-1' } })))
    const denied = parseResponse(await createComplianceChangeImpactAssessmentsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([intake.statusCode, createIntake.statusCode, impact.statusCode, createImpact.statusCode]).toEqual([200, 200, 200, 200])
    expect(intake.json.data.complianceRegulatoryChangeIntake.automaticRegulatoryClaims).toBe(false)
    expect(impact.json.data.complianceChangeImpactAssessment.automaticPolicyUpdate).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 45C compliance implementation planning', () => {
  it('prepares implementation plans without automatic implementation', async () => {
    const source = upstream()
    expect(source.complianceImplementationPlanning.eventType).toBe(SYSTEM_COMPLIANCE_IMPLEMENTATION_PLAN_PREPARED_EVENT)
    expect(source.complianceImplementationPlanning.automaticImplementation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceImplementationPlanningRepository({ database: { connected: true, query } })
    await repository.create({ id: 'plan-1', tenantContext, implementationStatus: 'ready', implementationScore: 88 })
    await repository.list({ tenantContext, implementationStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves implementation APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const plans = parseResponse(await createComplianceImplementationPlansHandler(options)(authEvent('GET')))
    const createPlan = parseResponse(await createComplianceImplementationPlansHandler(options)(authEvent('POST', { plan: { id: 'plan-1' } })))
    const denied = parseResponse(await createComplianceImplementationPlansHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([plans.statusCode, createPlan.statusCode]).toEqual([200, 200])
    expect(plans.json.data.complianceImplementationPlanning.automaticImplementation).toBe(false)
    expect(plans.json.data.complianceImplementationPlanning.automaticPolicyUpdate).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(plans.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
