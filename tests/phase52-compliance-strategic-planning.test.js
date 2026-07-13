import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceStrategicInitiativePortfolioRepository, evaluateComplianceStrategicInitiativePortfolio, SYSTEM_COMPLIANCE_STRATEGIC_INITIATIVE_PORTFOLIO_EVALUATED_EVENT } from '../lib/system/complianceStrategicInitiativePortfolioEngine.js'
import { createComplianceExecutiveStrategyPlanRepository, prepareComplianceExecutiveStrategyPlan, SYSTEM_COMPLIANCE_EXECUTIVE_STRATEGY_PLAN_PREPARED_EVENT } from '../lib/system/complianceExecutiveStrategyPlanEngine.js'
import { createComplianceStrategicInitiativePortfoliosHandler } from '../netlify/functions/compliance-strategic-initiative-portfolios.js'
import { createComplianceExecutiveStrategyPlansHandler } from '../netlify/functions/compliance-executive-strategy-plans.js'

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
      'x-request-id': 'req-phase52ab',
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
  const complianceOptimizationRoadmap = { eventType: 'system.complianceOptimizationRoadmap.planned', optimizationRoadmapSummary: { averageRoadmapScore: 92 } }
  const complianceContinuousImprovementProgram = { eventType: 'system.complianceContinuousImprovementProgram.evaluated', continuousImprovementSummary: { averageProgramScore: 91 } }
  const complianceResourcePlanning = { eventType: 'system.complianceResourcePlanning.evaluated', resourceSummary: { averageResourceScore: 90 } }
  const complianceExecutiveDashboard = { eventType: 'system.complianceExecutiveDashboard.evaluated', executiveDashboardSummary: { averageDashboardScore: 93 } }
  const complianceGovernanceReadout = { eventType: 'system.complianceGovernanceReadout.prepared', readoutSummary: { averageReadoutScore: 92 } }
  const complianceStrategicInitiativePortfolio = evaluateComplianceStrategicInitiativePortfolio({
    tenantContext,
    complianceOptimizationRoadmap,
    complianceContinuousImprovementProgram,
    complianceResourcePlanning,
  }, { emitEvent: false })
  const complianceExecutiveStrategyPlan = prepareComplianceExecutiveStrategyPlan({
    tenantContext,
    complianceStrategicInitiativePortfolio,
    complianceExecutiveDashboard,
    complianceGovernanceReadout,
  }, { emitEvent: false })
  return {
    complianceOptimizationRoadmap,
    complianceContinuousImprovementProgram,
    complianceResourcePlanning,
    complianceExecutiveDashboard,
    complianceGovernanceReadout,
    complianceStrategicInitiativePortfolio,
    complianceExecutiveStrategyPlan,
  }
}

describe('Phase 52A compliance strategic initiative portfolio', () => {
  it('adds idempotent strategic planning migrations and parameterized initiative access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_initiative_portfolios')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_executive_strategy_plans')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicInitiativePortfolioRepository({ database: { connected: true, query } })
    await repository.create({ id: 'initiative-1', tenantContext, initiativeStatus: 'aligned', initiativeScore: 92 })
    await repository.list({ tenantContext, initiativeStatus: 'aligned' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates initiative portfolios without approval, funding, or assignment automation', () => {
    const source = upstream()
    expect(source.complianceStrategicInitiativePortfolio.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_INITIATIVE_PORTFOLIO_EVALUATED_EVENT)
    expect(source.complianceStrategicInitiativePortfolio.automaticInitiativeApproval).toBe(false)
    expect(source.complianceStrategicInitiativePortfolio.automaticFundingAction).toBe(false)
    expect(source.complianceStrategicInitiativePortfolio.automaticAssignment).toBe(false)
  })

  it('serves strategic initiative APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicInitiativePortfoliosHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceStrategicInitiativePortfoliosHandler(options)(authEvent('POST', { initiative: { id: 'initiative-1' } })))
    const denied = parseResponse(await createComplianceStrategicInitiativePortfoliosHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicInitiativePortfolio.automaticInitiativeApproval).toBe(false)
    expect(create.json.data.initiative.automaticFundingAction).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 52B compliance executive strategy plan', () => {
  it('prepares executive strategy plans without executive approval or distribution automation', async () => {
    const source = upstream()
    expect(source.complianceExecutiveStrategyPlan.eventType).toBe(SYSTEM_COMPLIANCE_EXECUTIVE_STRATEGY_PLAN_PREPARED_EVENT)
    expect(source.complianceExecutiveStrategyPlan.automaticExecutiveApproval).toBe(false)
    expect(source.complianceExecutiveStrategyPlan.automaticDistribution).toBe(false)
    expect(source.complianceExecutiveStrategyPlan.automaticFundingAction).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceExecutiveStrategyPlanRepository({ database: { connected: true, query } })
    await repository.create({ id: 'strategy-1', tenantContext, strategyStatus: 'ready', strategyScore: 93 })
    await repository.list({ tenantContext, strategyStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves executive strategy APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceExecutiveStrategyPlansHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceExecutiveStrategyPlansHandler(options)(authEvent('POST', { strategy: { id: 'strategy-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceExecutiveStrategyPlansHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceExecutiveStrategyPlan.automaticExecutiveApproval).toBe(false)
    expect(create.json.data.strategy.automaticDistribution).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceExecutiveStrategyPlansHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
