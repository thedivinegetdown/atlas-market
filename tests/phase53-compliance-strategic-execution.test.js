import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceStrategicMilestonePlanRepository, planComplianceStrategicMilestones, SYSTEM_COMPLIANCE_STRATEGIC_MILESTONES_PLANNED_EVENT } from '../lib/system/complianceStrategicMilestonePlannerEngine.js'
import { createComplianceStrategicKpiEvaluationRepository, evaluateComplianceStrategicKpis, SYSTEM_COMPLIANCE_STRATEGIC_KPIS_EVALUATED_EVENT } from '../lib/system/complianceStrategicKpiTrackerEngine.js'
import { createComplianceStrategicMilestonePlansHandler } from '../netlify/functions/compliance-strategic-milestone-plans.js'
import { createComplianceStrategicKpiEvaluationsHandler } from '../netlify/functions/compliance-strategic-kpi-evaluations.js'

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
      'x-request-id': 'req-phase53ab',
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
  const complianceExecutiveStrategyPlan = { eventType: 'system.complianceExecutiveStrategyPlan.prepared', executiveStrategySummary: { averageStrategyScore: 93 } }
  const complianceStrategicInitiativePortfolio = { eventType: 'system.complianceStrategicInitiativePortfolio.evaluated', initiativePortfolioSummary: { averageInitiativeScore: 92 } }
  const complianceImplementationPlanning = { eventType: 'system.complianceImplementationPlanning.prepared', implementationSummary: { averageImplementationScore: 91 } }
  const complianceGovernanceActionItems = { eventType: 'system.complianceGovernanceActionItems.tracked', actionItemSummary: { highPriority: 0 } }
  const complianceStrategicMilestones = planComplianceStrategicMilestones({
    tenantContext,
    complianceExecutiveStrategyPlan,
    complianceImplementationPlanning,
    complianceGovernanceActionItems,
  }, { emitEvent: false })
  const complianceStrategicKpis = evaluateComplianceStrategicKpis({
    tenantContext,
    complianceStrategicMilestones,
    complianceExecutiveStrategyPlan,
    complianceStrategicInitiativePortfolio,
  }, { emitEvent: false })
  return {
    complianceExecutiveStrategyPlan,
    complianceStrategicInitiativePortfolio,
    complianceImplementationPlanning,
    complianceGovernanceActionItems,
    complianceStrategicMilestones,
    complianceStrategicKpis,
  }
}

describe('Phase 53A compliance strategic milestone planning', () => {
  it('adds idempotent strategic execution migrations and parameterized milestone access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_milestone_plans')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_kpi_evaluations')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicMilestonePlanRepository({ database: { connected: true, query } })
    await repository.create({ id: 'milestone-1', tenantContext, milestoneStatus: 'on-track', milestoneScore: 92 })
    await repository.list({ tenantContext, milestoneStatus: 'on-track' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('plans milestones without milestone approval, assignment, or funding automation', () => {
    const source = upstream()
    expect(source.complianceStrategicMilestones.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_MILESTONES_PLANNED_EVENT)
    expect(source.complianceStrategicMilestones.automaticMilestoneApproval).toBe(false)
    expect(source.complianceStrategicMilestones.automaticAssignment).toBe(false)
    expect(source.complianceStrategicMilestones.automaticFundingAction).toBe(false)
  })

  it('serves milestone planning APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicMilestonePlansHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceStrategicMilestonePlansHandler(options)(authEvent('POST', { milestone: { id: 'milestone-1' } })))
    const denied = parseResponse(await createComplianceStrategicMilestonePlansHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicMilestones.automaticMilestoneApproval).toBe(false)
    expect(create.json.data.milestone.automaticAssignment).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 53B compliance strategic KPI tracking', () => {
  it('evaluates strategic KPIs without KPI approval, executive distribution, or remediation automation', async () => {
    const source = upstream()
    expect(source.complianceStrategicKpis.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_KPIS_EVALUATED_EVENT)
    expect(source.complianceStrategicKpis.automaticKpiApproval).toBe(false)
    expect(source.complianceStrategicKpis.automaticExecutiveDistribution).toBe(false)
    expect(source.complianceStrategicKpis.automaticRemediation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicKpiEvaluationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'kpi-1', tenantContext, kpiStatus: 'meeting-target', kpiScore: 93 })
    await repository.list({ tenantContext, kpiStatus: 'meeting-target' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves strategic KPI APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicKpiEvaluationsHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceStrategicKpiEvaluationsHandler(options)(authEvent('POST', { kpi: { id: 'kpi-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceStrategicKpiEvaluationsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicKpis.automaticKpiApproval).toBe(false)
    expect(create.json.data.kpi.automaticExecutiveDistribution).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceStrategicKpiEvaluationsHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
