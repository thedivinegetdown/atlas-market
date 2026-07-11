import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { SYSTEM_COMPLIANCE_BOARD_PACKET_PREPARED_EVENT } from '../lib/system/complianceBoardPacketEngine.js'
import { SYSTEM_COMPLIANCE_EXAM_READINESS_EVALUATED_EVENT } from '../lib/system/complianceExamReadinessEngine.js'
import { SYSTEM_COMPLIANCE_RECORD_RETENTION_REVIEWED_EVENT } from '../lib/system/complianceRecordRetentionReviewEngine.js'
import { SYSTEM_COMPLIANCE_MEETING_MINUTES_RECORDED_EVENT, createComplianceMeetingMinutesRepository, recordComplianceMeetingMinutes } from '../lib/system/complianceMeetingMinutesEngine.js'
import { SYSTEM_COMPLIANCE_ACTION_ITEMS_TRACKED_EVENT, createComplianceGovernanceActionItemRepository, trackComplianceGovernanceActionItems } from '../lib/system/complianceGovernanceActionItemEngine.js'
import { SYSTEM_COMPLIANCE_PROGRAM_HEALTH_EVALUATED_EVENT, createComplianceProgramHealthRepository, evaluateComplianceProgramHealth } from '../lib/system/complianceProgramHealthEngine.js'
import { createComplianceMeetingMinutesHandler } from '../netlify/functions/compliance-meeting-minutes.js'
import { createComplianceGovernanceActionItemsHandler } from '../netlify/functions/compliance-governance-action-items.js'
import { createComplianceProgramHealthHandler } from '../netlify/functions/compliance-program-health.js'

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
      'x-request-id': 'req-phase40abc',
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
  const complianceBoardPacket = {
    eventType: SYSTEM_COMPLIANCE_BOARD_PACKET_PREPARED_EVENT,
    boardPacketStatus: 'ready',
    boardPacketSummary: { total: 1, readyForReview: 1, needsUpdates: 0 },
  }
  const complianceGovernanceDecisionLog = {
    eventType: 'system.complianceGovernanceDecision.recorded',
    decisionLogStatus: 'ready',
    decisionSummary: { total: 1, draft: 1, recorded: 0, needsReview: 0 },
    complianceGovernanceDecisions: [{ id: 'decision-1' }],
  }
  const complianceExamReadiness = {
    eventType: SYSTEM_COMPLIANCE_EXAM_READINESS_EVALUATED_EVENT,
    examReadinessStatus: 'ready',
    examReadinessSummary: { ready: 1, caution: 0, blocked: 0, averageScore: 95 },
  }
  const complianceRecordRetentionReview = {
    eventType: SYSTEM_COMPLIANCE_RECORD_RETENTION_REVIEWED_EVENT,
    retentionReviewStatus: 'ready',
    retentionReviewSummary: { current: 1, reviewDue: 0, needsUpdates: 0 },
  }
  const complianceRiskCommandCenter = { eventType: 'system.complianceRiskCommandCenter.evaluated', commandCenterStatus: 'healthy' }
  const complianceMeetingMinutes = recordComplianceMeetingMinutes({ tenantContext, complianceBoardPacket, complianceGovernanceDecisionLog, complianceExamReadiness }, { emitEvent: false })
  const complianceGovernanceActionItems = trackComplianceGovernanceActionItems({ tenantContext, complianceMeetingMinutes, complianceRecordRetentionReview, complianceExamReadiness }, { emitEvent: false })
  const complianceProgramHealth = evaluateComplianceProgramHealth({ tenantContext, complianceRiskCommandCenter, complianceExamReadiness, complianceBoardPacket, complianceMeetingMinutes, complianceGovernanceActionItems }, { emitEvent: false })
  return { complianceBoardPacket, complianceGovernanceDecisionLog, complianceExamReadiness, complianceRecordRetentionReview, complianceRiskCommandCenter, complianceMeetingMinutes, complianceGovernanceActionItems, complianceProgramHealth }
}

describe('Phase 40A compliance meeting minutes', () => {
  it('adds idempotent meeting/action/program migrations and parameterized minutes access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_meeting_minutes')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_governance_action_items')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_program_health_evaluations')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceMeetingMinutesRepository({ database: { connected: true, query } })
    await repository.create({ id: 'minutes-1', tenantContext, minutesStatus: 'ready_for_review' })
    await repository.list({ tenantContext, minutesStatus: 'ready_for_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('records meeting minutes without distribution or approval automation', () => {
    const source = upstream()
    expect(source.complianceMeetingMinutes.eventType).toBe(SYSTEM_COMPLIANCE_MEETING_MINUTES_RECORDED_EVENT)
    expect(source.complianceMeetingMinutes.automaticDistribution).toBe(false)
    expect(source.complianceMeetingMinutes.automaticApproval).toBe(false)
  })
})

describe('Phase 40B compliance governance action items', () => {
  it('tracks action items without automatic assignment or resolution', async () => {
    const source = upstream()
    expect(source.complianceGovernanceActionItems.eventType).toBe(SYSTEM_COMPLIANCE_ACTION_ITEMS_TRACKED_EVENT)
    expect(source.complianceGovernanceActionItems.automaticAssignment).toBe(false)
    expect(source.complianceGovernanceActionItems.automaticResolution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceGovernanceActionItemRepository({ database: { connected: true, query } })
    await repository.create({ id: 'action-1', tenantContext, actionStatus: 'open', actionPriority: 'medium' })
    await repository.list({ tenantContext, actionStatus: 'open', actionPriority: 'medium' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves minutes and action item APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const minutes = parseResponse(await createComplianceMeetingMinutesHandler(options)(authEvent('GET')))
    const createMinutes = parseResponse(await createComplianceMeetingMinutesHandler(options)(authEvent('POST', { minutes: { id: 'minutes-1' } })))
    const actions = parseResponse(await createComplianceGovernanceActionItemsHandler(options)(authEvent('GET')))
    const createAction = parseResponse(await createComplianceGovernanceActionItemsHandler(options)(authEvent('POST', { actionItem: { id: 'action-1' } })))
    const denied = parseResponse(await createComplianceGovernanceActionItemsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([minutes.statusCode, createMinutes.statusCode, actions.statusCode, createAction.statusCode]).toEqual([200, 200, 200, 200])
    expect(minutes.json.data.complianceMeetingMinutes.automaticDistribution).toBe(false)
    expect(actions.json.data.complianceGovernanceActionItems.automaticResolution).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 40C compliance program health', () => {
  it('evaluates program health without compliance claims or destructive automation', async () => {
    const source = upstream()
    expect(source.complianceProgramHealth.eventType).toBe(SYSTEM_COMPLIANCE_PROGRAM_HEALTH_EVALUATED_EVENT)
    expect(source.complianceProgramHealth.automaticComplianceClaims).toBe(false)
    expect(source.complianceProgramHealth.destructiveAutomation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceProgramHealthRepository({ database: { connected: true, query } })
    await repository.create({ id: 'health-1', tenantContext, healthStatus: 'healthy', healthScore: 95 })
    await repository.list({ tenantContext, healthStatus: 'healthy' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves program health APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const health = parseResponse(await createComplianceProgramHealthHandler(options)(authEvent('GET')))
    const createHealth = parseResponse(await createComplianceProgramHealthHandler(options)(authEvent('POST', { evaluation: { id: 'health-1' } })))
    const denied = parseResponse(await createComplianceProgramHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([health.statusCode, createHealth.statusCode]).toEqual([200, 200])
    expect(health.json.data.complianceProgramHealth.automaticComplianceClaims).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(health.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
