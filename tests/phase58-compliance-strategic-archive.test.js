import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceStrategicKnowledgeBaseRepository, updateComplianceStrategicKnowledgeBase, SYSTEM_COMPLIANCE_STRATEGIC_KNOWLEDGE_BASE_UPDATED_EVENT } from '../lib/system/complianceStrategicKnowledgeBaseEngine.js'
import { createComplianceStrategicDecisionArchiveRepository, archiveComplianceStrategicDecisions, SYSTEM_COMPLIANCE_STRATEGIC_DECISION_ARCHIVE_ARCHIVED_EVENT } from '../lib/system/complianceStrategicDecisionArchiveEngine.js'
import { createComplianceStrategicKnowledgeBaseHandler } from '../netlify/functions/compliance-strategic-knowledge-base.js'
import { createComplianceStrategicDecisionArchivesHandler } from '../netlify/functions/compliance-strategic-decision-archives.js'

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
      'x-request-id': 'req-phase58ab',
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
  const complianceStrategicLearningSummary = { eventType: 'system.complianceStrategicLearningSummary.captured', strategicLearningSummary: { averageLearningScore: 94 } }
  const complianceStrategicOutcomeReview = { eventType: 'system.complianceStrategicOutcome.reviewed', strategicOutcomeSummary: { averageOutcomeScore: 93 } }
  const complianceLessonsLearned = { eventType: 'system.complianceLessonsLearned.captured', lessonsLearnedSummary: { averageLessonScore: 92 } }
  const complianceGovernanceDecisionLog = { eventType: 'system.complianceGovernanceDecisionLog.recorded', governanceDecisionSummary: { averageDecisionScore: 91 } }
  const complianceExecutiveStrategyPlan = { eventType: 'system.complianceExecutiveStrategyPlan.prepared', executiveStrategySummary: { averageStrategyScore: 90 } }
  const complianceStrategicKnowledgeBase = updateComplianceStrategicKnowledgeBase({
    tenantContext,
    complianceStrategicLearningSummary,
    complianceStrategicOutcomeReview,
    complianceLessonsLearned,
  }, { emitEvent: false })
  const complianceStrategicDecisionArchive = archiveComplianceStrategicDecisions({
    tenantContext,
    complianceStrategicKnowledgeBase,
    complianceGovernanceDecisionLog,
    complianceExecutiveStrategyPlan,
  }, { emitEvent: false })
  return {
    complianceStrategicLearningSummary,
    complianceStrategicOutcomeReview,
    complianceLessonsLearned,
    complianceGovernanceDecisionLog,
    complianceExecutiveStrategyPlan,
    complianceStrategicKnowledgeBase,
    complianceStrategicDecisionArchive,
  }
}

describe('Phase 58A compliance strategic knowledge base', () => {
  it('adds idempotent strategic archive migrations and parameterized knowledge access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_knowledge_base')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_decision_archives')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicKnowledgeBaseRepository({ database: { connected: true, query } })
    await repository.create({ id: 'knowledge-1', tenantContext, knowledgeStatus: 'current', knowledgeScore: 92 })
    await repository.list({ tenantContext, knowledgeStatus: 'current' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('updates strategic knowledge without knowledge claims, policy updates, or strategy changes', () => {
    const source = upstream()
    expect(source.complianceStrategicKnowledgeBase.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_KNOWLEDGE_BASE_UPDATED_EVENT)
    expect(source.complianceStrategicKnowledgeBase.automaticKnowledgeClaim).toBe(false)
    expect(source.complianceStrategicKnowledgeBase.automaticPolicyUpdate).toBe(false)
    expect(source.complianceStrategicKnowledgeBase.automaticStrategyChange).toBe(false)
  })

  it('serves strategic knowledge APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicKnowledgeBaseHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceStrategicKnowledgeBaseHandler(options)(authEvent('POST', { knowledge: { id: 'knowledge-1' } })))
    const denied = parseResponse(await createComplianceStrategicKnowledgeBaseHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicKnowledgeBase.automaticKnowledgeClaim).toBe(false)
    expect(create.json.data.knowledge.automaticPolicyUpdate).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 58B compliance strategic decision archive', () => {
  it('archives strategic decisions without decision claims, approval, or distribution automation', async () => {
    const source = upstream()
    expect(source.complianceStrategicDecisionArchive.eventType).toBe(SYSTEM_COMPLIANCE_STRATEGIC_DECISION_ARCHIVE_ARCHIVED_EVENT)
    expect(source.complianceStrategicDecisionArchive.automaticDecisionClaim).toBe(false)
    expect(source.complianceStrategicDecisionArchive.automaticDecisionApproval).toBe(false)
    expect(source.complianceStrategicDecisionArchive.automaticDistribution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceStrategicDecisionArchiveRepository({ database: { connected: true, query } })
    await repository.create({ id: 'decision-1', tenantContext, archiveStatus: 'archived', archiveScore: 92 })
    await repository.list({ tenantContext, archiveStatus: 'archived' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves strategic decision archive APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceStrategicDecisionArchivesHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceStrategicDecisionArchivesHandler(options)(authEvent('POST', { decision: { id: 'decision-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceStrategicDecisionArchivesHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceStrategicDecisionArchive.automaticDecisionClaim).toBe(false)
    expect(create.json.data.decision.automaticDecisionApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceStrategicDecisionArchivesHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
