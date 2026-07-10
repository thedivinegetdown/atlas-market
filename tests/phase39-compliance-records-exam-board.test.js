import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { SYSTEM_COMPLIANCE_AUDIT_READINESS_PREPARED_EVENT } from '../lib/system/complianceAuditReadinessPackageEngine.js'
import { SYSTEM_COMPLIANCE_EXTERNAL_REVIEW_PLANNED_EVENT } from '../lib/system/complianceExternalReviewPlannerEngine.js'
import { SYSTEM_COMPLIANCE_GOVERNANCE_DECISION_RECORDED_EVENT } from '../lib/system/complianceGovernanceDecisionLogEngine.js'
import { SYSTEM_COMPLIANCE_RECORD_RETENTION_REVIEWED_EVENT, createComplianceRecordRetentionReviewRepository, reviewComplianceRecordRetention } from '../lib/system/complianceRecordRetentionReviewEngine.js'
import { SYSTEM_COMPLIANCE_EXAM_READINESS_EVALUATED_EVENT, createComplianceExamReadinessRepository, evaluateComplianceExamReadiness } from '../lib/system/complianceExamReadinessEngine.js'
import { SYSTEM_COMPLIANCE_BOARD_PACKET_PREPARED_EVENT, createComplianceBoardPacketRepository, prepareComplianceBoardPacket } from '../lib/system/complianceBoardPacketEngine.js'
import { createComplianceRecordRetentionReviewsHandler } from '../netlify/functions/compliance-record-retention-reviews.js'
import { createComplianceExamReadinessHandler } from '../netlify/functions/compliance-exam-readiness.js'
import { createComplianceBoardPacketsHandler } from '../netlify/functions/compliance-board-packets.js'

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
      'x-request-id': 'req-phase39abc',
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
  const complianceAuditReadinessPackage = {
    eventType: SYSTEM_COMPLIANCE_AUDIT_READINESS_PREPARED_EVENT,
    auditReadinessStatus: 'ready',
    auditReadinessSummary: { total: 1, readyForReview: 1, needsUpdates: 0 },
  }
  const complianceExternalReviewPlanning = {
    eventType: SYSTEM_COMPLIANCE_EXTERNAL_REVIEW_PLANNED_EVENT,
    externalReviewStatus: 'ready',
    externalReviewSummary: { total: 1, readyForReview: 1, needsUpdates: 0 },
  }
  const complianceGovernanceDecisionLog = {
    eventType: SYSTEM_COMPLIANCE_GOVERNANCE_DECISION_RECORDED_EVENT,
    decisionLogStatus: 'ready',
    decisionSummary: { total: 1, draft: 1, recorded: 0, needsReview: 0 },
  }
  const complianceRiskCommandCenter = { eventType: 'system.complianceRiskCommandCenter.evaluated', commandCenterStatus: 'healthy' }
  const evidenceGovernance = { eventType: 'system.evidenceGovernance.evaluated', governanceSummary: { retentionDue: 0 } }
  const complianceRecordRetentionReview = reviewComplianceRecordRetention({ tenantContext, evidenceGovernance, complianceAuditReadinessPackage, complianceExternalReviewPlanning, complianceGovernanceDecisionLog }, { emitEvent: false })
  const complianceExamReadiness = evaluateComplianceExamReadiness({ tenantContext, complianceAuditReadinessPackage, complianceExternalReviewPlanning, complianceRecordRetentionReview, complianceRiskCommandCenter }, { emitEvent: false })
  const complianceBoardPacket = prepareComplianceBoardPacket({ tenantContext, complianceGovernanceReadout: { eventType: 'system.complianceGovernanceReadout.prepared', readoutStatus: 'ready' }, complianceGovernanceDecisionLog, complianceRecordRetentionReview, complianceExamReadiness }, { emitEvent: false })
  return { evidenceGovernance, complianceAuditReadinessPackage, complianceExternalReviewPlanning, complianceGovernanceDecisionLog, complianceRiskCommandCenter, complianceRecordRetentionReview, complianceExamReadiness, complianceBoardPacket }
}

describe('Phase 39A compliance record retention review', () => {
  it('adds idempotent record/exam/board migrations and parameterized retention access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_record_retention_reviews')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_exam_readiness_evaluations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_board_packets')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceRecordRetentionReviewRepository({ database: { connected: true, query } })
    await repository.create({ id: 'retention-1', tenantContext, reviewStatus: 'current', retentionDomain: 'audit-readiness' })
    await repository.list({ tenantContext, reviewStatus: 'current', retentionDomain: 'audit-readiness' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('reviews records without deletion, mutation, or archival automation', () => {
    const source = upstream()
    expect(source.complianceRecordRetentionReview.eventType).toBe(SYSTEM_COMPLIANCE_RECORD_RETENTION_REVIEWED_EVENT)
    expect(source.complianceRecordRetentionReview.noDeletion).toBe(true)
    expect(source.complianceRecordRetentionReview.noMutation).toBe(true)
    expect(source.complianceRecordRetentionReview.automaticArchival).toBe(false)
  })
})

describe('Phase 39B compliance exam readiness', () => {
  it('evaluates exam readiness without submission or compliance claims', async () => {
    const source = upstream()
    expect(source.complianceExamReadiness.eventType).toBe(SYSTEM_COMPLIANCE_EXAM_READINESS_EVALUATED_EVENT)
    expect(source.complianceExamReadiness.automaticSubmission).toBe(false)
    expect(source.complianceExamReadiness.automaticComplianceClaims).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceExamReadinessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'exam-1', tenantContext, readinessStatus: 'ready', readinessScore: 95 })
    await repository.list({ tenantContext, readinessStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves retention and exam APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const retention = parseResponse(await createComplianceRecordRetentionReviewsHandler(options)(authEvent('GET')))
    const createRetention = parseResponse(await createComplianceRecordRetentionReviewsHandler(options)(authEvent('POST', { review: { id: 'retention-1' } })))
    const exam = parseResponse(await createComplianceExamReadinessHandler(options)(authEvent('GET')))
    const createExam = parseResponse(await createComplianceExamReadinessHandler(options)(authEvent('POST', { evaluation: { id: 'exam-1' } })))
    const denied = parseResponse(await createComplianceExamReadinessHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([retention.statusCode, createRetention.statusCode, exam.statusCode, createExam.statusCode]).toEqual([200, 200, 200, 200])
    expect(retention.json.data.complianceRecordRetentionReview.noDeletion).toBe(true)
    expect(exam.json.data.complianceExamReadiness.automaticSubmission).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 39C compliance board packets', () => {
  it('prepares board packets without distribution or approval automation', async () => {
    const source = upstream()
    expect(source.complianceBoardPacket.eventType).toBe(SYSTEM_COMPLIANCE_BOARD_PACKET_PREPARED_EVENT)
    expect(source.complianceBoardPacket.automaticDistribution).toBe(false)
    expect(source.complianceBoardPacket.automaticApproval).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceBoardPacketRepository({ database: { connected: true, query } })
    await repository.create({ id: 'packet-1', tenantContext, packetStatus: 'ready_for_review' })
    await repository.list({ tenantContext, packetStatus: 'ready_for_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves board packet APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const packets = parseResponse(await createComplianceBoardPacketsHandler(options)(authEvent('GET')))
    const createPacket = parseResponse(await createComplianceBoardPacketsHandler(options)(authEvent('POST', { packet: { id: 'packet-1' } })))
    const denied = parseResponse(await createComplianceBoardPacketsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([packets.statusCode, createPacket.statusCode]).toEqual([200, 200])
    expect(packets.json.data.complianceBoardPacket.automaticDistribution).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(packets.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
