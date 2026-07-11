import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateComplianceTrendAnalytics } from '../lib/system/complianceTrendAnalyticsEngine.js'
import { evaluateComplianceRiskForecast } from '../lib/system/complianceRiskForecastEngine.js'
import { assessComplianceMaturity } from '../lib/system/complianceMaturityAssessmentEngine.js'
import { createComplianceBenchmarkComparisonRepository, evaluateComplianceBenchmarkComparison, SYSTEM_COMPLIANCE_BENCHMARK_COMPARISON_EVALUATED_EVENT } from '../lib/system/complianceBenchmarkComparisonEngine.js'
import { createComplianceScenarioPlanningRepository, evaluateComplianceScenarioPlanning, SYSTEM_COMPLIANCE_SCENARIO_PLANNING_EVALUATED_EVENT } from '../lib/system/complianceScenarioPlanningEngine.js'
import { createComplianceResourcePlanningRepository, evaluateComplianceResourcePlanning, SYSTEM_COMPLIANCE_RESOURCE_PLANNING_EVALUATED_EVENT } from '../lib/system/complianceResourcePlanningEngine.js'
import { createComplianceBenchmarkComparisonsHandler } from '../netlify/functions/compliance-benchmark-comparisons.js'
import { createComplianceScenarioPlansHandler } from '../netlify/functions/compliance-scenario-plans.js'
import { createComplianceResourcePlansHandler } from '../netlify/functions/compliance-resource-plans.js'

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
      'x-request-id': 'req-phase43abc',
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
  const complianceMetricsSnapshot = { eventType: 'system.complianceMetricsSnapshot.captured', metricsSnapshotStatus: 'ready', metricsSnapshotSummary: { averageHealthScore: 94, openActionItems: 1 } }
  const complianceExecutiveDashboard = { eventType: 'system.complianceExecutiveDashboard.evaluated', executiveDashboardStatus: 'healthy', executiveDashboardSummary: { averageScore: 94, healthy: 1, caution: 0, blocked: 0 } }
  const complianceProgramHealth = { eventType: 'system.complianceProgramHealth.evaluated', programHealthStatus: 'healthy', programHealthSummary: { averageScore: 92 } }
  const complianceGovernanceActionItems = { eventType: 'system.complianceActionItems.tracked', actionItemSummary: { highPriority: 1, blocked: 0 } }
  const complianceTrendAnalytics = evaluateComplianceTrendAnalytics({ tenantContext, complianceMetricsSnapshot, complianceExecutiveDashboard }, { emitEvent: false })
  const complianceRiskForecast = evaluateComplianceRiskForecast({ tenantContext, complianceTrendAnalytics, complianceProgramHealth, complianceGovernanceActionItems }, { emitEvent: false })
  const complianceMaturityAssessment = assessComplianceMaturity({ tenantContext, complianceExecutiveDashboard, complianceTrendAnalytics, complianceRiskForecast }, { emitEvent: false })
  const complianceBenchmarkComparison = evaluateComplianceBenchmarkComparison({ tenantContext, complianceMaturityAssessment, complianceTrendAnalytics }, { emitEvent: false })
  const complianceScenarioPlanning = evaluateComplianceScenarioPlanning({ tenantContext, complianceRiskForecast, complianceBenchmarkComparison }, { emitEvent: false })
  const complianceResourcePlanning = evaluateComplianceResourcePlanning({ tenantContext, complianceScenarioPlanning, complianceGovernanceActionItems }, { emitEvent: false })
  return { complianceGovernanceActionItems, complianceTrendAnalytics, complianceRiskForecast, complianceMaturityAssessment, complianceBenchmarkComparison, complianceScenarioPlanning, complianceResourcePlanning }
}

describe('Phase 43A compliance benchmark comparison', () => {
  it('adds idempotent planning analytics migrations and parameterized benchmark access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_benchmark_comparisons')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_scenario_plans')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_resource_plans')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceBenchmarkComparisonRepository({ database: { connected: true, query } })
    await repository.create({ id: 'benchmark-1', tenantContext, benchmarkStatus: 'aligned', benchmarkScore: 88 })
    await repository.list({ tenantContext, benchmarkStatus: 'aligned' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates benchmark comparison without compliance claims or approvals', () => {
    const source = upstream()
    expect(source.complianceBenchmarkComparison.eventType).toBe(SYSTEM_COMPLIANCE_BENCHMARK_COMPARISON_EVALUATED_EVENT)
    expect(source.complianceBenchmarkComparison.automaticComplianceClaims).toBe(false)
    expect(source.complianceBenchmarkComparison.automaticApproval).toBe(false)
  })
})

describe('Phase 43B compliance scenario planning', () => {
  it('evaluates scenarios without automatic remediation', async () => {
    const source = upstream()
    expect(source.complianceScenarioPlanning.eventType).toBe(SYSTEM_COMPLIANCE_SCENARIO_PLANNING_EVALUATED_EVENT)
    expect(source.complianceScenarioPlanning.automaticRemediation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceScenarioPlanningRepository({ database: { connected: true, query } })
    await repository.create({ id: 'scenario-1', tenantContext, scenarioStatus: 'resilient', scenarioScore: 90 })
    await repository.list({ tenantContext, scenarioStatus: 'resilient' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves benchmark and scenario APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const benchmarks = parseResponse(await createComplianceBenchmarkComparisonsHandler(options)(authEvent('GET')))
    const createBenchmark = parseResponse(await createComplianceBenchmarkComparisonsHandler(options)(authEvent('POST', { comparison: { id: 'benchmark-1' } })))
    const scenarios = parseResponse(await createComplianceScenarioPlansHandler(options)(authEvent('GET')))
    const createScenario = parseResponse(await createComplianceScenarioPlansHandler(options)(authEvent('POST', { scenario: { id: 'scenario-1' } })))
    const denied = parseResponse(await createComplianceScenarioPlansHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([benchmarks.statusCode, createBenchmark.statusCode, scenarios.statusCode, createScenario.statusCode]).toEqual([200, 200, 200, 200])
    expect(benchmarks.json.data.complianceBenchmarkComparison.automaticComplianceClaims).toBe(false)
    expect(scenarios.json.data.complianceScenarioPlanning.automaticRemediation).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 43C compliance resource planning', () => {
  it('evaluates resource plans without assignment or budget automation', async () => {
    const source = upstream()
    expect(source.complianceResourcePlanning.eventType).toBe(SYSTEM_COMPLIANCE_RESOURCE_PLANNING_EVALUATED_EVENT)
    expect(source.complianceResourcePlanning.automaticAssignment).toBe(false)
    expect(source.complianceResourcePlanning.automaticBudgetAction).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceResourcePlanningRepository({ database: { connected: true, query } })
    await repository.create({ id: 'resource-1', tenantContext, resourceStatus: 'sufficient', resourceScore: 90 })
    await repository.list({ tenantContext, resourceStatus: 'sufficient' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves resource planning APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const resources = parseResponse(await createComplianceResourcePlansHandler(options)(authEvent('GET')))
    const createResource = parseResponse(await createComplianceResourcePlansHandler(options)(authEvent('POST', { plan: { id: 'resource-1' } })))
    const denied = parseResponse(await createComplianceResourcePlansHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([resources.statusCode, createResource.statusCode]).toEqual([200, 200])
    expect(resources.json.data.complianceResourcePlanning.automaticAssignment).toBe(false)
    expect(resources.json.data.complianceResourcePlanning.automaticBudgetAction).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(resources.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
