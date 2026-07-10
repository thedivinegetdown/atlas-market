import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { prioritizeOperatorAttention } from '../lib/system/operatorAttentionPrioritizationEngine.js'
import { buildAdministrativeCases } from '../lib/system/administrativeCaseManagementEngine.js'
import { collectAdministrativeEvidence } from '../lib/system/administrativeEvidenceEngine.js'
import { buildRemediationPlans } from '../lib/system/remediationPlanningEngine.js'
import { evaluateEvidenceGovernance } from '../lib/system/evidenceGovernanceEngine.js'
import { evaluateRemediationEffectiveness } from '../lib/system/remediationEffectivenessEngine.js'
import { evaluateAdministrativeGovernanceCommandCenter } from '../lib/system/administrativeGovernanceCommandCenterEngine.js'
import {
  SYSTEM_ADMINISTRATIVE_POLICY_EVALUATED_EVENT,
  SYSTEM_ADMINISTRATIVE_POLICY_UPDATED_EVENT,
  createAdministrativePolicyRepository,
  evaluateAdministrativePolicyGovernance,
  updateAdministrativePolicyStatus,
} from '../lib/system/administrativePolicyGovernanceEngine.js'
import {
  SYSTEM_CONTROL_ASSURANCE_REVIEWED_EVENT,
  SYSTEM_POLICY_EXCEPTION_UPDATED_EVENT,
  createControlAssuranceRepository,
  createPolicyExceptionRepository,
  evaluateControlAssurance,
  normalizePolicyException,
  updatePolicyExceptionStatus,
} from '../lib/system/controlAssuranceEngine.js'
import {
  SYSTEM_POLICY_CONTROL_ASSURANCE_COMMAND_CENTER_EVALUATED_EVENT,
  evaluatePolicyControlAssuranceCommandCenter,
} from '../lib/system/policyControlAssuranceCommandCenterEngine.js'
import { createAdministrativePoliciesHandler } from '../netlify/functions/administrative-policies.js'
import { createPolicyStatusUpdateHandler } from '../netlify/functions/policy-status-update.js'
import { createControlAssuranceReviewHandler } from '../netlify/functions/control-assurance-review.js'
import { createPolicyExceptionsHandler } from '../netlify/functions/policy-exceptions.js'
import { createPolicyExceptionStatusUpdateHandler } from '../netlify/functions/policy-exception-status-update.js'
import { createPolicyControlAssuranceHealthHandler } from '../netlify/functions/policy-control-assurance-health.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }
const notificationDigest = { eventType: 'system.notificationDigest.generated', normalizedNotificationDigest: { unreadCount: 3, criticalCount: 1 } }
const userActivityRiskReview = { eventType: 'system.userActivityRiskReview.evaluated', activityRiskFindings: [{ id: 'risk-1', severity: 'high', summary: 'Repeated access policy finding.' }] }
const administrationWorkflowSla = { eventType: 'system.administrationWorkflowSla.evaluated', workflowSlaItems: [{ workflowId: 'workflow-1', category: 'access review', priority: 'high', slaStatus: 'breached' }] }

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
      'x-request-id': 'req-phase33',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', id: 'policy-1', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'owner') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function policyRepository() {
  const records = []
  return {
    connected: false,
    create: vi.fn(async (policy) => { records.push(policy); return { ok: true, policy } }),
    list: vi.fn(async () => records),
    get: vi.fn(async ({ id }) => records.find((item) => item.id === id) ?? null),
    updateStatus: vi.fn(async ({ id, policyStatus }) => ({ ok: true, policy: { id, policyStatus } })),
  }
}

function exceptionRepository() {
  const records = []
  return {
    connected: false,
    create: vi.fn(async (exception) => { records.push(exception); return { ok: true, exception } }),
    list: vi.fn(async () => records),
    updateStatus: vi.fn(async ({ id, exceptionStatus }) => ({ ok: true, exception: { id, exceptionStatus } })),
  }
}

function upstream() {
  const operatorAttention = prioritizeOperatorAttention({ tenantContext, notificationDigest, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
  const administrativeCases = buildAdministrativeCases({ tenantContext, operatorAttention }, { emitEvent: false })
  const administrativeEvidence = collectAdministrativeEvidence({ tenantContext, administrativeCases, operatorAttention, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
  const remediationPlanning = buildRemediationPlans({ tenantContext, administrativeEvidence, administrativeCases, operatorAttention }, { emitEvent: false })
  const evidenceGovernance = evaluateEvidenceGovernance({ administrativeEvidence, administrativeCases }, { emitEvent: false })
  const remediationEffectiveness = evaluateRemediationEffectiveness({ remediationPlanning, administrativeEvidence, administrativeCases, operatorAttention, administrationWorkflowSla }, { emitEvent: false })
  const administrativeGovernanceCommandCenter = evaluateAdministrativeGovernanceCommandCenter({ evidenceGovernance, remediationEffectiveness, operatorAttention }, { emitEvent: false })
  const policyGovernance = evaluateAdministrativePolicyGovernance({ tenantContext, evidenceGovernance, remediationEffectiveness, administrativeGovernanceCommandCenter }, { emitEvent: false })
  const policyExceptions = [normalizePolicyException({ id: 'exception-1', policyId: policyGovernance.administrativePolicies[0].id, controlId: 'control-access-governance', tenantContext, exceptionSeverity: 'high' })]
  const controlAssurance = evaluateControlAssurance({ policyGovernance, evidenceGovernance, remediationEffectiveness, policyExceptions }, { emitEvent: false })
  return { operatorAttention, administrativeCases, administrativeEvidence, remediationPlanning, evidenceGovernance, remediationEffectiveness, administrativeGovernanceCommandCenter, policyGovernance, policyExceptions, controlAssurance }
}

describe('Phase 33A administrative policy governance engine', () => {
  it('adds idempotent policy/control migrations and parameterized policy repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_administrative_policies')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_control_assurance_evaluations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_policy_exceptions')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAdministrativePolicyRepository({ database: { connected: true, query } })
    await repository.create({ id: 'policy-1', tenantContext, policyDomain: 'access governance' })
    await repository.list({ tenantContext, policyStatus: 'active' })
    await repository.get({ id: 'policy-1', tenantContext })
    await repository.updateStatus({ id: 'policy-1', tenantContext, policyStatus: 'under_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates policy governance as decision support without automatic enforcement', async () => {
    const source = upstream()
    const policyGovernance = evaluateAdministrativePolicyGovernance({ tenantContext, evidenceGovernance: source.evidenceGovernance, remediationEffectiveness: source.remediationEffectiveness }, { emitEvent: false })
    const updated = await updateAdministrativePolicyStatus({ id: 'policy-1', tenantContext, policyStatus: 'under_review' }, { repository: policyRepository(), emitEvent: false })
    expect(policyGovernance.eventType).toBe(SYSTEM_ADMINISTRATIVE_POLICY_EVALUATED_EVENT)
    expect(updated.eventType).toBe(SYSTEM_ADMINISTRATIVE_POLICY_UPDATED_EVENT)
    expect(policyGovernance.automaticEnforcement).toBe(false)
    expect(policyGovernance.administrativePolicies.length).toBeGreaterThan(5)
    expect(JSON.stringify(policyGovernance)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })

  it('serves owner/admin policy APIs and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), policyRepository: policyRepository(), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const list = parseResponse(await createAdministrativePoliciesHandler(options)(authEvent('GET')))
    const create = parseResponse(await createAdministrativePoliciesHandler(options)(authEvent('POST', { policy: { id: 'policy-1', policyDomain: 'access governance', policyStatus: 'active' } })))
    const update = parseResponse(await createPolicyStatusUpdateHandler(options)(authEvent('POST', { id: 'policy-1', policyStatus: 'under_review' })))
    const denied = parseResponse(await createAdministrativePoliciesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([list.statusCode, create.statusCode, update.statusCode]).toEqual([200, 200, 200])
    expect(list.json.data.policyGovernance.automaticEnforcement).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 33B control assurance and exception management', () => {
  it('maps controls to policy outputs and keeps exception handling human-reviewed', async () => {
    const source = upstream()
    const controlAssurance = evaluateControlAssurance(source, { emitEvent: false })
    const updated = await updatePolicyExceptionStatus({ id: 'exception-1', tenantContext, exceptionStatus: 'acknowledged' }, { repository: exceptionRepository(), emitEvent: false })
    expect(controlAssurance.eventType).toBe(SYSTEM_CONTROL_ASSURANCE_REVIEWED_EVENT)
    expect(updated.eventType).toBe(SYSTEM_POLICY_EXCEPTION_UPDATED_EVENT)
    expect(controlAssurance.automaticExceptionApproval).toBe(false)
    expect(controlAssurance.automaticFindingResolution).toBe(false)
    expect(controlAssurance.controlAssuranceEvaluations.length).toBeGreaterThan(5)

    const query = vi.fn(async () => ({ rows: [] }))
    const assuranceRepo = createControlAssuranceRepository({ database: { connected: true, query } })
    const exceptionRepo = createPolicyExceptionRepository({ database: { connected: true, query } })
    await assuranceRepo.create(controlAssurance.controlAssuranceEvaluations[0])
    await assuranceRepo.list({ tenantContext, controlStatus: 'ineffective' })
    await exceptionRepo.create(source.policyExceptions[0])
    await exceptionRepo.list({ tenantContext, exceptionStatus: 'open' })
    await exceptionRepo.updateStatus({ id: 'exception-1', tenantContext, exceptionStatus: 'acknowledged' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves owner/admin assurance and exception APIs and denies analyst access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), policyExceptionRepository: exceptionRepository(), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const assurance = parseResponse(await createControlAssuranceReviewHandler(options)(authEvent('GET')))
    const exceptions = parseResponse(await createPolicyExceptionsHandler(options)(authEvent('GET')))
    const createException = parseResponse(await createPolicyExceptionsHandler(options)(authEvent('POST', { exception: { id: 'exception-1', policyId: 'policy-1', controlId: 'control-1' } })))
    const updateException = parseResponse(await createPolicyExceptionStatusUpdateHandler(options)(authEvent('POST', { id: 'exception-1', exceptionStatus: 'acknowledged' })))
    const denied = parseResponse(await createControlAssuranceReviewHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([assurance.statusCode, exceptions.statusCode, createException.statusCode, updateException.statusCode]).toEqual([200, 200, 200, 200])
    expect(assurance.json.data.controlAssurance.automaticEnforcementActions).toBe(false)
    expect(createException.json.data.automaticExceptionApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 33C policy and control assurance command center', () => {
  it('summarizes normalized policy and control outputs without destructive actions', () => {
    const source = upstream()
    const commandCenter = evaluatePolicyControlAssuranceCommandCenter({
      policyGovernance: source.policyGovernance,
      controlAssurance: source.controlAssurance,
      administrativeGovernanceCommandCenter: source.administrativeGovernanceCommandCenter,
      tenantAdministrationOperations: { eventType: 'system.tenantAdministrationOperations.evaluated', operationalStatus: 'healthy' },
      operatorIntelligenceCommandCenter: { eventType: 'system.operatorIntelligenceCommandCenter.evaluated', commandCenterStatus: 'caution' },
    }, { emitEvent: false })
    expect(commandCenter.eventType).toBe(SYSTEM_POLICY_CONTROL_ASSURANCE_COMMAND_CENTER_EVALUATED_EVENT)
    expect(commandCenter.activePolicies).toBeGreaterThan(0)
    expect(commandCenter.safeSummariesOnly).toBe(true)
    expect(commandCenter.automaticPolicyEnforcement).toBe(false)
    expect(commandCenter.automaticExceptionApproval).toBe(false)
    expect(commandCenter.destructiveActionsEnabled).toBe(false)
  })

  it('serves policy control assurance health safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createPolicyControlAssuranceHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createPolicyControlAssuranceHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.commandCenter.safeSummariesOnly).toBe(true)
    expect(owner.json.data.commandCenter.liveOrders).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})
