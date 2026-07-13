import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createAiDecisionGovernanceReadinessRepository, evaluateAiDecisionGovernanceReadiness, SYSTEM_AI_DECISION_GOVERNANCE_READINESS_EVALUATED_EVENT } from '../lib/system/aiDecisionGovernanceReadinessEngine.js'
import { createAiDecisionExplainabilityRepository, prepareAiDecisionExplainability, SYSTEM_AI_DECISION_EXPLAINABILITY_PREPARED_EVENT } from '../lib/system/aiDecisionExplainabilityEngine.js'
import { createAiDecisionGovernanceReadinessHandler } from '../netlify/functions/ai-decision-governance-readiness.js'
import { createAiDecisionExplainabilityRecordsHandler } from '../netlify/functions/ai-decision-explainability-records.js'

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
      'x-request-id': 'req-phase59ab',
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
  const aiDecision = {
    eventType: 'ai.decision.orchestrated',
    finalDecision: 'approve',
    confidenceScore: 91,
    blockers: [],
    rationale: 'AI decision is approved for paper review.',
  }
  const researchEnhancedDecision = {
    eventType: 'ai.decision.researchEnhanced',
    researchInfluenceScore: 90,
    finalResearchAwareDecisionSummary: { finalDecision: 'approve' },
    blockers: [],
    decisionAdjustmentRationale: 'Research confirms approve decision.',
  }
  const enterpriseReleaseControl = { eventType: 'system.releaseControl.evaluated', finalReleaseStatus: 'release-ready' }
  const enterpriseAuditTrail = { eventType: 'system.auditTrail.recorded', auditIntegrityStatus: { status: 'valid' } }
  const complianceStrategicKnowledgeBase = { eventType: 'system.complianceStrategicKnowledgeBase.updated', strategicKnowledgeSummary: { averageKnowledgeScore: 92 } }
  const aiDecisionGovernanceReadiness = evaluateAiDecisionGovernanceReadiness({
    tenantContext,
    aiDecision,
    researchEnhancedDecision,
    enterpriseReleaseControl,
    enterpriseAuditTrail,
  }, { emitEvent: false })
  const aiDecisionExplainability = prepareAiDecisionExplainability({
    tenantContext,
    aiDecisionGovernanceReadiness,
    aiDecision,
    researchEnhancedDecision,
    complianceStrategicKnowledgeBase,
  }, { emitEvent: false })
  return {
    aiDecision,
    researchEnhancedDecision,
    enterpriseReleaseControl,
    enterpriseAuditTrail,
    complianceStrategicKnowledgeBase,
    aiDecisionGovernanceReadiness,
    aiDecisionExplainability,
  }
}

describe('Phase 59A AI decision governance readiness', () => {
  it('adds idempotent AI governance migrations and parameterized readiness access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_decision_governance_readiness')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_ai_decision_explainability_records')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiDecisionGovernanceReadinessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'ai-governance-1', tenantContext, governanceStatus: 'ready', governanceScore: 92 })
    await repository.list({ tenantContext, governanceStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates AI governance without model approval, policy enforcement, or decision overrides', () => {
    const source = upstream()
    expect(source.aiDecisionGovernanceReadiness.eventType).toBe(SYSTEM_AI_DECISION_GOVERNANCE_READINESS_EVALUATED_EVENT)
    expect(source.aiDecisionGovernanceReadiness.automaticModelApproval).toBe(false)
    expect(source.aiDecisionGovernanceReadiness.automaticPolicyEnforcement).toBe(false)
    expect(source.aiDecisionGovernanceReadiness.automaticDecisionOverride).toBe(false)
  })

  it('serves AI governance APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiDecisionGovernanceReadinessHandler(options)(authEvent('GET')))
    const create = parseResponse(await createAiDecisionGovernanceReadinessHandler(options)(authEvent('POST', { readiness: { id: 'ai-governance-1' } })))
    const denied = parseResponse(await createAiDecisionGovernanceReadinessHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiDecisionGovernanceReadiness.automaticModelApproval).toBe(false)
    expect(create.json.data.readiness.automaticDecisionOverride).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 59B AI decision explainability', () => {
  it('prepares explainability without explanation claims, model approval, or decision overrides', async () => {
    const source = upstream()
    expect(source.aiDecisionExplainability.eventType).toBe(SYSTEM_AI_DECISION_EXPLAINABILITY_PREPARED_EVENT)
    expect(source.aiDecisionExplainability.automaticExplanationClaim).toBe(false)
    expect(source.aiDecisionExplainability.automaticModelApproval).toBe(false)
    expect(source.aiDecisionExplainability.automaticDecisionOverride).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAiDecisionExplainabilityRepository({ database: { connected: true, query } })
    await repository.create({ id: 'ai-explainability-1', tenantContext, explainabilityStatus: 'complete', explainabilityScore: 92 })
    await repository.list({ tenantContext, explainabilityStatus: 'complete' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves AI explainability APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createAiDecisionExplainabilityRecordsHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createAiDecisionExplainabilityRecordsHandler(options)(authEvent('POST', { explanation: { id: 'ai-explainability-1' } }, 'admin')))
    const denied = parseResponse(await createAiDecisionExplainabilityRecordsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.aiDecisionExplainability.automaticExplanationClaim).toBe(false)
    expect(create.json.data.explanation.automaticDecisionOverride).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createAiDecisionExplainabilityRecordsHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
