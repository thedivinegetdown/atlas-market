import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateAdministrativePolicyGovernance } from '../lib/system/administrativePolicyGovernanceEngine.js'
import { evaluateControlAssurance, normalizePolicyException } from '../lib/system/controlAssuranceEngine.js'
import { evaluatePolicyControlAssuranceCommandCenter } from '../lib/system/policyControlAssuranceCommandCenterEngine.js'
import {
  SYSTEM_POLICY_ATTESTATION_EVALUATED_EVENT,
  createPolicyAttestationRepository,
  evaluatePolicyAttestations,
} from '../lib/system/policyAttestationEngine.js'
import {
  SYSTEM_CONTROL_TESTING_EVALUATED_EVENT,
  createControlTestingRepository,
  evaluateControlTesting,
} from '../lib/system/controlTestingEngine.js'
import {
  SYSTEM_COMPLIANCE_READINESS_COMMAND_CENTER_EVALUATED_EVENT,
  evaluateComplianceReadinessCommandCenter,
} from '../lib/system/complianceReadinessCommandCenterEngine.js'
import { createPolicyAttestationsHandler } from '../netlify/functions/policy-attestations.js'
import { createControlTestingReviewHandler } from '../netlify/functions/control-testing-review.js'
import { createComplianceReadinessHealthHandler } from '../netlify/functions/compliance-readiness-health.js'

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
      'x-request-id': 'req-phase34',
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
  const policyGovernance = evaluateAdministrativePolicyGovernance({ tenantContext }, { emitEvent: false })
  const policyExceptions = [normalizePolicyException({ id: 'exception-1', tenantContext, policyId: policyGovernance.administrativePolicies[0].id, exceptionSeverity: 'high' })]
  const controlAssurance = evaluateControlAssurance({ policyGovernance, policyExceptions }, { emitEvent: false })
  const policyControlAssuranceCommandCenter = evaluatePolicyControlAssuranceCommandCenter({ policyGovernance, controlAssurance }, { emitEvent: false })
  const policyAttestation = evaluatePolicyAttestations({ tenantContext, policyGovernance, controlAssurance }, { emitEvent: false })
  const controlTesting = evaluateControlTesting({ policyGovernance, controlAssurance }, { emitEvent: false })
  return { policyGovernance, policyExceptions, controlAssurance, policyControlAssuranceCommandCenter, policyAttestation, controlTesting }
}

describe('Phase 34A policy attestation engine', () => {
  it('adds idempotent attestation/control-test migrations and parameterized attestation repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_policy_attestations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_control_tests')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createPolicyAttestationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'attestation-1', tenantContext, policyId: 'policy-1' })
    await repository.list({ tenantContext, attestationStatus: 'pending' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates policy attestations without automatic approval or enforcement', () => {
    const source = upstream()
    expect(source.policyAttestation.eventType).toBe(SYSTEM_POLICY_ATTESTATION_EVALUATED_EVENT)
    expect(source.policyAttestation.policyAttestations.length).toBeGreaterThan(0)
    expect(source.policyAttestation.automaticApproval).toBe(false)
    expect(source.policyAttestation.automaticEnforcement).toBe(false)
  })

  it('serves owner/admin attestation API and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const list = parseResponse(await createPolicyAttestationsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createPolicyAttestationsHandler(options)(authEvent('POST', { attestation: { id: 'attestation-1', policyId: 'policy-1' } })))
    const denied = parseResponse(await createPolicyAttestationsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([list.statusCode, create.statusCode]).toEqual([200, 200])
    expect(list.json.data.policyAttestation.automaticApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 34B control testing engine', () => {
  it('evaluates control tests without resolving findings or enforcement actions', async () => {
    const source = upstream()
    expect(source.controlTesting.eventType).toBe(SYSTEM_CONTROL_TESTING_EVALUATED_EVENT)
    expect(source.controlTesting.controlTests.length).toBeGreaterThan(0)
    expect(source.controlTesting.automaticFindingResolution).toBe(false)
    expect(source.controlTesting.automaticEnforcementActions).toBe(false)

    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createControlTestingRepository({ database: { connected: true, query } })
    await repository.create(source.controlTesting.controlTests[0])
    await repository.list({ tenantContext, testStatus: 'in_progress' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves owner/admin control testing API and denies analyst access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const review = parseResponse(await createControlTestingReviewHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createControlTestingReviewHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect(review.statusCode).toBe(200)
    expect(review.json.data.controlTesting.automaticFindingResolution).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 34C compliance readiness command center', () => {
  it('summarizes attestations and control tests without compliance claims', () => {
    const source = upstream()
    const commandCenter = evaluateComplianceReadinessCommandCenter(source, { emitEvent: false })
    expect(commandCenter.eventType).toBe(SYSTEM_COMPLIANCE_READINESS_COMMAND_CENTER_EVALUATED_EVENT)
    expect(commandCenter.pendingAttestations).toBeGreaterThanOrEqual(0)
    expect(commandCenter.automaticComplianceClaims).toBe(false)
    expect(commandCenter.automaticEnforcementActions).toBe(false)
    expect(commandCenter.liveOrders).toBe(false)
  })

  it('serves compliance readiness health safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createComplianceReadinessHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createComplianceReadinessHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.commandCenter.safeSummariesOnly).toBe(true)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(owner.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
