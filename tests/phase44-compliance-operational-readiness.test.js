import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateComplianceProgramHealth } from '../lib/system/complianceProgramHealthEngine.js'
import { evaluateComplianceResourcePlanning } from '../lib/system/complianceResourcePlanningEngine.js'
import { createComplianceTrainingReadinessRepository, evaluateComplianceTrainingReadiness, SYSTEM_COMPLIANCE_TRAINING_READINESS_EVALUATED_EVENT } from '../lib/system/complianceTrainingReadinessEngine.js'
import { createComplianceThirdPartyOversightRepository, evaluateComplianceThirdPartyOversight, SYSTEM_COMPLIANCE_THIRD_PARTY_OVERSIGHT_EVALUATED_EVENT } from '../lib/system/complianceThirdPartyOversightEngine.js'
import { createComplianceContinuityReadinessRepository, evaluateComplianceContinuityReadiness, SYSTEM_COMPLIANCE_CONTINUITY_READINESS_EVALUATED_EVENT } from '../lib/system/complianceContinuityReadinessEngine.js'
import { createComplianceTrainingReadinessHandler } from '../netlify/functions/compliance-training-readiness.js'
import { createComplianceThirdPartyOversightHandler } from '../netlify/functions/compliance-third-party-oversight.js'
import { createComplianceContinuityReadinessHandler } from '../netlify/functions/compliance-continuity-readiness.js'

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
      'x-request-id': 'req-phase44abc',
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
  const complianceProgramHealth = evaluateComplianceProgramHealth({ tenantContext, complianceMeetingMinutes: [], complianceGovernanceActionItems: [] }, { emitEvent: false })
  const complianceResourcePlanning = evaluateComplianceResourcePlanning({
    tenantContext,
    complianceScenarioPlanning: { eventType: 'system.complianceScenarioPlanning.evaluated', scenarioSummary: { averageScenarioScore: 91 } },
    complianceGovernanceActionItems: { eventType: 'system.complianceActionItems.tracked', actionItemSummary: { highPriority: 0 } },
  }, { emitEvent: false })
  const productionSecurityReadiness = { eventType: 'system.securityReadiness.evaluated', securityReadinessStatus: 'ready' }
  const dataLineage = { eventType: 'system.dataLineage.evaluated', lineageStatus: 'valid' }
  const productionOperationsRunbook = { eventType: 'system.operationsRunbook.generated', operatorHandoffSummary: { handoffStatus: 'ready' } }
  const complianceTrainingReadiness = evaluateComplianceTrainingReadiness({ tenantContext, complianceResourcePlanning, complianceProgramHealth }, { emitEvent: false })
  const complianceThirdPartyOversight = evaluateComplianceThirdPartyOversight({ tenantContext, productionSecurityReadiness, dataLineage }, { emitEvent: false })
  const complianceContinuityReadiness = evaluateComplianceContinuityReadiness({ tenantContext, complianceTrainingReadiness, complianceThirdPartyOversight, productionOperationsRunbook }, { emitEvent: false })
  return { complianceProgramHealth, complianceResourcePlanning, productionSecurityReadiness, dataLineage, productionOperationsRunbook, complianceTrainingReadiness, complianceThirdPartyOversight, complianceContinuityReadiness }
}

describe('Phase 44A compliance training readiness', () => {
  it('adds idempotent operational readiness migrations and parameterized training access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_training_readiness')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_third_party_oversight')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_continuity_readiness')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceTrainingReadinessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'training-1', tenantContext, trainingStatus: 'ready', trainingScore: 92 })
    await repository.list({ tenantContext, trainingStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates training readiness without automatic assignment or claims', () => {
    const source = upstream()
    expect(source.complianceTrainingReadiness.eventType).toBe(SYSTEM_COMPLIANCE_TRAINING_READINESS_EVALUATED_EVENT)
    expect(source.complianceTrainingReadiness.automaticAssignment).toBe(false)
    expect(source.complianceTrainingReadiness.automaticComplianceClaims).toBe(false)
  })
})

describe('Phase 44B compliance third-party oversight', () => {
  it('evaluates third-party oversight without vendor automation', async () => {
    const source = upstream()
    expect(source.complianceThirdPartyOversight.eventType).toBe(SYSTEM_COMPLIANCE_THIRD_PARTY_OVERSIGHT_EVALUATED_EVENT)
    expect(source.complianceThirdPartyOversight.automaticVendorAction).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceThirdPartyOversightRepository({ database: { connected: true, query } })
    await repository.create({ id: 'third-party-1', tenantContext, oversightStatus: 'healthy', oversightScore: 90 })
    await repository.list({ tenantContext, oversightStatus: 'healthy' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves training and third-party APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const training = parseResponse(await createComplianceTrainingReadinessHandler(options)(authEvent('GET')))
    const createTraining = parseResponse(await createComplianceTrainingReadinessHandler(options)(authEvent('POST', { readiness: { id: 'training-1' } })))
    const oversight = parseResponse(await createComplianceThirdPartyOversightHandler(options)(authEvent('GET')))
    const createOversight = parseResponse(await createComplianceThirdPartyOversightHandler(options)(authEvent('POST', { oversight: { id: 'third-party-1' } })))
    const denied = parseResponse(await createComplianceThirdPartyOversightHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([training.statusCode, createTraining.statusCode, oversight.statusCode, createOversight.statusCode]).toEqual([200, 200, 200, 200])
    expect(training.json.data.complianceTrainingReadiness.automaticAssignment).toBe(false)
    expect(oversight.json.data.complianceThirdPartyOversight.automaticVendorAction).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 44C compliance continuity readiness', () => {
  it('evaluates continuity readiness without failover automation', async () => {
    const source = upstream()
    expect(source.complianceContinuityReadiness.eventType).toBe(SYSTEM_COMPLIANCE_CONTINUITY_READINESS_EVALUATED_EVENT)
    expect(source.complianceContinuityReadiness.automaticFailover).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceContinuityReadinessRepository({ database: { connected: true, query } })
    await repository.create({ id: 'continuity-1', tenantContext, continuityStatus: 'ready', continuityScore: 92 })
    await repository.list({ tenantContext, continuityStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves continuity APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const continuity = parseResponse(await createComplianceContinuityReadinessHandler(options)(authEvent('GET')))
    const createContinuity = parseResponse(await createComplianceContinuityReadinessHandler(options)(authEvent('POST', { readiness: { id: 'continuity-1' } })))
    const denied = parseResponse(await createComplianceContinuityReadinessHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([continuity.statusCode, createContinuity.statusCode]).toEqual([200, 200])
    expect(continuity.json.data.complianceContinuityReadiness.automaticFailover).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(continuity.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
