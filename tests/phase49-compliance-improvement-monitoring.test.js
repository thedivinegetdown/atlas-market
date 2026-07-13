import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceImprovementBacklogRepository, prioritizeComplianceImprovementBacklog, SYSTEM_COMPLIANCE_IMPROVEMENT_BACKLOG_PRIORITIZED_EVENT } from '../lib/system/complianceImprovementBacklogEngine.js'
import { createComplianceAdoptionMonitoringRepository, evaluateComplianceAdoptionMonitoring, SYSTEM_COMPLIANCE_ADOPTION_MONITORING_EVALUATED_EVENT } from '../lib/system/complianceAdoptionMonitoringEngine.js'
import { createComplianceImprovementBacklogHandler } from '../netlify/functions/compliance-improvement-backlog.js'
import { createComplianceAdoptionMonitoringHandler } from '../netlify/functions/compliance-adoption-monitoring.js'

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
      'x-request-id': 'req-phase49ab',
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
  const complianceImprovementOpportunity = { eventType: 'system.complianceImprovementOpportunity.identified', opportunitySummary: { averageOpportunityScore: 92 } }
  const complianceAdoptionReadiness = { eventType: 'system.complianceAdoptionReadiness.evaluated', adoptionSummary: { averageAdoptionScore: 91 } }
  const complianceProgramHealth = { eventType: 'system.complianceProgramHealth.evaluated', programHealthSummary: { averageScore: 93 } }
  const complianceExecutiveDashboard = { eventType: 'system.complianceExecutiveDashboard.evaluated', executiveDashboardSummary: { averageDashboardScore: 90 } }
  const complianceImprovementBacklog = prioritizeComplianceImprovementBacklog({ tenantContext, complianceImprovementOpportunity, complianceAdoptionReadiness }, { emitEvent: false })
  const complianceAdoptionMonitoring = evaluateComplianceAdoptionMonitoring({ tenantContext, complianceImprovementBacklog, complianceProgramHealth, complianceExecutiveDashboard }, { emitEvent: false })
  return { complianceImprovementOpportunity, complianceAdoptionReadiness, complianceProgramHealth, complianceExecutiveDashboard, complianceImprovementBacklog, complianceAdoptionMonitoring }
}

describe('Phase 49A compliance improvement backlog', () => {
  it('adds idempotent backlog/monitoring migrations and parameterized backlog access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_improvement_backlog_items')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_adoption_monitoring')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceImprovementBacklogRepository({ database: { connected: true, query } })
    await repository.create({ id: 'backlog-1', tenantContext, backlogStatus: 'prioritized', backlogPriority: 'high', backlogScore: 92 })
    await repository.list({ tenantContext, backlogStatus: 'prioritized', backlogPriority: 'high' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prioritizes improvement backlog without assignments or remediation automation', () => {
    const source = upstream()
    expect(source.complianceImprovementBacklog.eventType).toBe(SYSTEM_COMPLIANCE_IMPROVEMENT_BACKLOG_PRIORITIZED_EVENT)
    expect(source.complianceImprovementBacklog.automaticPrioritizationExecution).toBe(false)
    expect(source.complianceImprovementBacklog.automaticAssignment).toBe(false)
    expect(source.complianceImprovementBacklog.automaticRemediation).toBe(false)
  })

  it('serves backlog APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceImprovementBacklogHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceImprovementBacklogHandler(options)(authEvent('POST', { item: { id: 'backlog-1' } })))
    const denied = parseResponse(await createComplianceImprovementBacklogHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceImprovementBacklog.automaticAssignment).toBe(false)
    expect(create.json.data.item.automaticRemediation).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 49B compliance adoption monitoring', () => {
  it('evaluates adoption monitoring without automatic monitoring actions', async () => {
    const source = upstream()
    expect(source.complianceAdoptionMonitoring.eventType).toBe(SYSTEM_COMPLIANCE_ADOPTION_MONITORING_EVALUATED_EVENT)
    expect(source.complianceAdoptionMonitoring.automaticMonitoringAction).toBe(false)
    expect(source.complianceAdoptionMonitoring.automaticAdoption).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceAdoptionMonitoringRepository({ database: { connected: true, query } })
    await repository.create({ id: 'monitoring-1', tenantContext, monitoringStatus: 'healthy', monitoringScore: 91 })
    await repository.list({ tenantContext, monitoringStatus: 'healthy' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves monitoring APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceAdoptionMonitoringHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceAdoptionMonitoringHandler(options)(authEvent('POST', { monitoring: { id: 'monitoring-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceAdoptionMonitoringHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceAdoptionMonitoring.automaticMonitoringAction).toBe(false)
    expect(create.json.data.monitoring.automaticAssignment).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceAdoptionMonitoringHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
