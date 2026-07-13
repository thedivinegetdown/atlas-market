import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceStrategicFeedbackIntakeRepository, evaluateComplianceStrategicFeedbackIntake, SYSTEM_COMPLIANCE_STRATEGIC_FEEDBACK_INTAKE_EVALUATED_EVENT } from '../lib/system/complianceStrategicFeedbackIntakeEngine.js'
import { createComplianceStrategicCommunicationEffectivenessRepository, reviewComplianceStrategicCommunicationEffectiveness, SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_EFFECTIVENESS_REVIEWED_EVENT } from '../lib/system/complianceStrategicCommunicationEffectivenessEngine.js'
import { createComplianceStrategicFeedbackIntakeHandler } from '../netlify/functions/compliance-strategic-feedback-intake.js'
import { createComplianceStrategicCommunicationEffectivenessHandler } from '../netlify/functions/compliance-strategic-communication-effectiveness.js'

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
      'x-request-id': 'req-phase55ab',
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
  const complianceStrategicCommunicationPlan = { eventType: 'system.complianceStrategicCommunicationPlan.prepared', strategicCommunicationSummary: { averageCommunicationScore: 93 } }
  const complianceStrategicStakeholderAlignment = { eventType: 'system.complianceStrategicStakeholderAlignment.evaluated', stakeholderAlignmentSummary: { averageAlignmentScore: 92 } }
  const complianceStrategicKpis = { eventType: 'system.complianceStrategicKpis.evaluated', strategicKpiSummary: { averageKpiScore: 91 } }
  const operatorActionCenter = { eventType: 'system.operatorActions.generated', platformActionSummary: { openActions: 0 } }
  const complianceStrategicFeedbackIntake = evaluateComplianceStrategicFeedbackIntake({
    tenantContext,
    complianceStrategicCommunicationPlan,
    complianceStrategicStakeholderAlignment,
    operatorActionCenter,
  }, { emitEvent: false })
  const complianceStrategicCommunicationEffectiveness = reviewComplianceStrategicCommunicationEffectiveness({
    tenantContext,
    complianceStrategicFeedbackIntake,
    complianceStrategicCommunicationPlan,
    complianceStrategicKpis,
  }, { emitEvent: false })
  return {
    complianceStrategicCommunicationPlan,
    complianceStrategicStakeholderAlignment,
    complianceStrategicKpis,
    operatorActionCenter,
    complianceStrategicFeedbackIntake,
    complianceStrategicCommunicationEffectiveness,
  }
}

describe('Phase 55A compliance strategic feedback intake', () => {
  it('adds idempotent strategic feedback migrations and parameterized feedback access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_feedback_intake')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_communication_effectiveness')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicFeedbackIntakeRepository({ database: { connected: true, query } })
    await repository.create({ id: 'feedback-1', tenantContext, feedbackStatus: 'constructive', feedbackScore: 92 })
    await repository.list({ tenantContext, feedbackStatus: 'constructive' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates feedback intake without feedback collection or escalation automation', () => {
    const source = upstream()
    expect(source.complianceStrategicFeedbackIntake.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_FEEDBACK_INTAKE_EVALUATED_EVENT)
    expect(source.complianceStrategicFeedbackIntake.automaticFeedbackCollection).toBe(false)
    expect(source.complianceStrategicFeedbackIntake.automaticEscalation).toBe(false)
    expect(source.complianceStrategicFeedbackIntake.automaticAssignment).toBe(false)
  })

  it('serves strategic feedback APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicFeedbackIntakeHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceStrategicFeedbackIntakeHandler(options)(authEvent('POST', { feedback: { id: 'feedback-1' } })))
    const denied = parseResponse(await createComplianceStrategicFeedbackIntakeHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicFeedbackIntake.automaticFeedbackCollection).toBe(false)
    expect(create.json.data.feedback.automaticEscalation).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 55B compliance strategic communication effectiveness', () => {
  it('reviews communication effectiveness without claims, remediation, or distribution automation', async () => {
    const source = upstream()
    expect(source.complianceStrategicCommunicationEffectiveness.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_COMMUNICATION_EFFECTIVENESS_REVIEWED_EVENT)
    expect(source.complianceStrategicCommunicationEffectiveness.automaticEffectivenessClaim).toBe(false)
    expect(source.complianceStrategicCommunicationEffectiveness.automaticRemediation).toBe(false)
    expect(source.complianceStrategicCommunicationEffectiveness.automaticDistribution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicCommunicationEffectivenessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'effectiveness-1', tenantContext, effectivenessStatus: 'effective', effectivenessScore: 93 })
    await repository.list({ tenantContext, effectivenessStatus: 'effective' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves communication effectiveness APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicCommunicationEffectivenessHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceStrategicCommunicationEffectivenessHandler(options)(authEvent('POST', { effectiveness: { id: 'effectiveness-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceStrategicCommunicationEffectivenessHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicCommunicationEffectiveness.automaticEffectivenessClaim).toBe(false)
    expect(create.json.data.effectiveness.automaticRemediation).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceStrategicCommunicationEffectivenessHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
