import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceStrategicRefinementBacklogRepository, prioritizeComplianceStrategicRefinementBacklog, SYSTEM_COMPLIANCE_STRATEGIC_REFINEMENT_BACKLOG_PRIORITIZED_EVENT } from '../lib/system/complianceStrategicRefinementBacklogEngine.js'
import { createComplianceStrategicAdaptationReadinessRepository, evaluateComplianceStrategicAdaptationReadiness, SYSTEM_COMPLIANCE_STRATEGIC_ADAPTATION_READINESS_EVALUATED_EVENT } from '../lib/system/complianceStrategicAdaptationReadinessEngine.js'
import { createComplianceStrategicRefinementBacklogHandler } from '../netlify/functions/compliance-strategic-refinement-backlog.js'
import { createComplianceStrategicAdaptationReadinessHandler } from '../netlify/functions/compliance-strategic-adaptation-readiness.js'

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
      'x-request-id': 'req-phase56ab',
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
  const complianceStrategicFeedbackIntake = { eventType: 'system.complianceStrategicFeedbackIntake.evaluated', strategicFeedbackSummary: { averageFeedbackScore: 93 } }
  const complianceStrategicCommunicationEffectiveness = { eventType: 'system.complianceStrategicCommunicationEffectiveness.reviewed', communicationEffectivenessSummary: { averageEffectivenessScore: 92 } }
  const complianceExecutiveStrategyPlan = { eventType: 'system.complianceExecutiveStrategyPlan.prepared', executiveStrategySummary: { averageStrategyScore: 91 } }
  const operatorActionCenter = { eventType: 'system.operatorActions.generated', platformActionSummary: { openActions: 0 } }
  const complianceStrategicRefinementBacklog = prioritizeComplianceStrategicRefinementBacklog({
    tenantContext,
    complianceStrategicFeedbackIntake,
    complianceStrategicCommunicationEffectiveness,
    operatorActionCenter,
  }, { emitEvent: false })
  const complianceStrategicAdaptationReadiness = evaluateComplianceStrategicAdaptationReadiness({
    tenantContext,
    complianceStrategicRefinementBacklog,
    complianceStrategicCommunicationEffectiveness,
    complianceExecutiveStrategyPlan,
  }, { emitEvent: false })
  return {
    complianceStrategicFeedbackIntake,
    complianceStrategicCommunicationEffectiveness,
    complianceExecutiveStrategyPlan,
    operatorActionCenter,
    complianceStrategicRefinementBacklog,
    complianceStrategicAdaptationReadiness,
  }
}

describe('Phase 56A compliance strategic refinement backlog', () => {
  it('adds idempotent strategic adaptation migrations and parameterized refinement access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_refinement_backlog')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_adaptation_readiness')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicRefinementBacklogRepository({ database: { connected: true, query } })
    await repository.create({ id: 'refinement-1', tenantContext, refinementStatus: 'prioritized', refinementScore: 92 })
    await repository.list({ tenantContext, refinementStatus: 'prioritized' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prioritizes refinement backlog without refinement, assignment, or remediation automation', () => {
    const source = upstream()
    expect(source.complianceStrategicRefinementBacklog.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_REFINEMENT_BACKLOG_PRIORITIZED_EVENT)
    expect(source.complianceStrategicRefinementBacklog.automaticRefinement).toBe(false)
    expect(source.complianceStrategicRefinementBacklog.automaticAssignment).toBe(false)
    expect(source.complianceStrategicRefinementBacklog.automaticRemediation).toBe(false)
  })

  it('serves strategic refinement APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicRefinementBacklogHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceStrategicRefinementBacklogHandler(options)(authEvent('POST', { refinement: { id: 'refinement-1' } })))
    const denied = parseResponse(await createComplianceStrategicRefinementBacklogHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicRefinementBacklog.automaticRefinement).toBe(false)
    expect(create.json.data.refinement.automaticAssignment).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 56B compliance strategic adaptation readiness', () => {
  it('evaluates adaptation readiness without adaptation, strategy change, or approval automation', async () => {
    const source = upstream()
    expect(source.complianceStrategicAdaptationReadiness.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_ADAPTATION_READINESS_EVALUATED_EVENT)
    expect(source.complianceStrategicAdaptationReadiness.automaticAdaptation).toBe(false)
    expect(source.complianceStrategicAdaptationReadiness.automaticStrategyChange).toBe(false)
    expect(source.complianceStrategicAdaptationReadiness.automaticApproval).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicAdaptationReadinessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'adaptation-1', tenantContext, adaptationStatus: 'ready', adaptationScore: 93 })
    await repository.list({ tenantContext, adaptationStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves strategic adaptation APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicAdaptationReadinessHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceStrategicAdaptationReadinessHandler(options)(authEvent('POST', { adaptation: { id: 'adaptation-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceStrategicAdaptationReadinessHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicAdaptationReadiness.automaticAdaptation).toBe(false)
    expect(create.json.data.adaptation.automaticStrategyChange).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceStrategicAdaptationReadinessHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
