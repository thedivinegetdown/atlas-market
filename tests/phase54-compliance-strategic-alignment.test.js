import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceStrategicStakeholderAlignmentRepository, evaluateComplianceStrategicStakeholderAlignment, SYSTEM_COMPLIANCE_STRATEGIC_STAKEHOLDER_ALIGNMENT_EVALUATED_EVENT } from '../lib/system/complianceStrategicStakeholderAlignmentEngine.js'
import { createComplianceStrategicCommunicationPlanRepository, prepareComplianceStrategicCommunicationPlan, SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_PLAN_PREPARED_EVENT } from '../lib/system/complianceStrategicCommunicationPlanEngine.js'
import { createComplianceStrategicStakeholderAlignmentsHandler } from '../netlify/functions/compliance-strategic-stakeholder-alignments.js'
import { createComplianceStrategicCommunicationPlansHandler } from '../netlify/functions/compliance-strategic-communication-plans.js'

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
      'x-request-id': 'req-phase54ab',
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
  const complianceStrategicKpis = { eventType: 'system.complianceStrategicKpis.evaluated', strategicKpiSummary: { averageKpiScore: 93 } }
  const complianceStrategicMilestones = { eventType: 'system.complianceStrategicMilestones.planned', strategicMilestoneSummary: { averageMilestoneScore: 92 } }
  const complianceGovernanceReadout = { eventType: 'system.complianceGovernanceReadout.prepared', readoutSummary: { averageReadoutScore: 91 } }
  const complianceExecutiveStrategyPlan = { eventType: 'system.complianceExecutiveStrategyPlan.prepared', executiveStrategySummary: { averageStrategyScore: 94 } }
  const complianceStrategicStakeholderAlignment = evaluateComplianceStrategicStakeholderAlignment({
    tenantContext,
    complianceStrategicKpis,
    complianceStrategicMilestones,
    complianceGovernanceReadout,
  }, { emitEvent: false })
  const complianceStrategicCommunicationPlan = prepareComplianceStrategicCommunicationPlan({
    tenantContext,
    complianceStrategicStakeholderAlignment,
    complianceExecutiveStrategyPlan,
    complianceGovernanceReadout,
  }, { emitEvent: false })
  return {
    complianceStrategicKpis,
    complianceStrategicMilestones,
    complianceGovernanceReadout,
    complianceExecutiveStrategyPlan,
    complianceStrategicStakeholderAlignment,
    complianceStrategicCommunicationPlan,
  }
}

describe('Phase 54A compliance strategic stakeholder alignment', () => {
  it('adds idempotent strategic alignment migrations and parameterized alignment access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_stakeholder_alignments')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_communication_plans')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicStakeholderAlignmentRepository({ database: { connected: true, query } })
    await repository.create({ id: 'alignment-1', tenantContext, alignmentStatus: 'aligned', alignmentScore: 92 })
    await repository.list({ tenantContext, alignmentStatus: 'aligned' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates stakeholder alignment without stakeholder approval or distribution automation', () => {
    const source = upstream()
    expect(source.complianceStrategicStakeholderAlignment.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_STAKEHOLDER_ALIGNMENT_EVALUATED_EVENT)
    expect(source.complianceStrategicStakeholderAlignment.automaticStakeholderApproval).toBe(false)
    expect(source.complianceStrategicStakeholderAlignment.automaticExecutiveDistribution).toBe(false)
    expect(source.complianceStrategicStakeholderAlignment.automaticAssignment).toBe(false)
  })

  it('serves stakeholder alignment APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicStakeholderAlignmentsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceStrategicStakeholderAlignmentsHandler(options)(authEvent('POST', { alignment: { id: 'alignment-1' } })))
    const denied = parseResponse(await createComplianceStrategicStakeholderAlignmentsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicStakeholderAlignment.automaticStakeholderApproval).toBe(false)
    expect(create.json.data.alignment.automaticExecutiveDistribution).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 54B compliance strategic communication planning', () => {
  it('prepares communication plans without message approval or distribution automation', async () => {
    const source = upstream()
    expect(source.complianceStrategicCommunicationPlan.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_PLAN_PREPARED_EVENT)
    expect(source.complianceStrategicCommunicationPlan.automaticDistribution).toBe(false)
    expect(source.complianceStrategicCommunicationPlan.automaticMessageApproval).toBe(false)
    expect(source.complianceStrategicCommunicationPlan.automaticAssignment).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicCommunicationPlanRepository({ database: { connected: true, query } })
    await repository.create({ id: 'communication-1', tenantContext, communicationStatus: 'ready', communicationScore: 93 })
    await repository.list({ tenantContext, communicationStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves strategic communication APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicCommunicationPlansHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceStrategicCommunicationPlansHandler(options)(authEvent('POST', { communication: { id: 'communication-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceStrategicCommunicationPlansHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicCommunicationPlan.automaticDistribution).toBe(false)
    expect(create.json.data.communication.automaticMessageApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceStrategicCommunicationPlansHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
