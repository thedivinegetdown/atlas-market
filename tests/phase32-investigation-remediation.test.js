import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { prioritizeOperatorAttention } from '../lib/system/operatorAttentionPrioritizationEngine.js'
import { buildAdministrativeCases } from '../lib/system/administrativeCaseManagementEngine.js'
import {
  SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT,
  SYSTEM_ADMINISTRATIVE_EVIDENCE_REVIEW_UPDATED_EVENT,
  collectAdministrativeEvidence,
  createAdministrativeEvidence,
  createAdministrativeEvidenceRepository,
  updateEvidenceReviewStatus,
} from '../lib/system/administrativeEvidenceEngine.js'
import {
  SYSTEM_REMEDIATION_PLAN_CREATED_EVENT,
  SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT,
  buildRemediationPlans,
  createRemediationPlan,
  createRemediationPlanRepository,
  updateRemediationPlanApproval,
  updateRemediationPlanExecution,
} from '../lib/system/remediationPlanningEngine.js'
import {
  SYSTEM_INVESTIGATION_REMEDIATION_COMMAND_CENTER_EVALUATED_EVENT,
  evaluateInvestigationRemediationCommandCenter,
} from '../lib/system/investigationRemediationCommandCenterEngine.js'
import { createAdministrativeEvidenceHandler } from '../netlify/functions/administrative-evidence.js'
import { createEvidenceReviewStatusUpdateHandler } from '../netlify/functions/evidence-review-status-update.js'
import { createRemediationPlansHandler } from '../netlify/functions/remediation-plans.js'
import { createRemediationPlanApprovalUpdateHandler } from '../netlify/functions/remediation-plan-approval-update.js'
import { createRemediationPlanStatusUpdateHandler } from '../netlify/functions/remediation-plan-status-update.js'
import { createInvestigationRemediationHealthHandler } from '../netlify/functions/investigation-remediation-health.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }
const notificationDigest = { eventType: 'system.notificationDigest.generated', normalizedNotificationDigest: { unreadCount: 4, criticalCount: 1 } }
const userActivityRiskReview = { eventType: 'system.userActivityRiskReview.evaluated', activityRiskFindings: [{ id: 'risk-1', severity: 'high', summary: 'High-risk activity finding.', references: ['activity-1'] }] }
const administrationWorkflowSla = { eventType: 'system.administrationWorkflowSla.evaluated', workflowSlaItems: [{ workflowId: 'workflow-1', category: 'session review', priority: 'high', slaStatus: 'breached', escalationPlanning: 'owner/admin review recommended' }] }

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
      'x-request-id': 'req-phase32',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', id: 'item-1' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'owner') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function evidenceRepository() {
  const records = []
  return {
    connected: false,
    create: vi.fn(async (evidence) => { records.push(evidence); return { ok: true, evidence } }),
    list: vi.fn(async () => records),
    get: vi.fn(async ({ id }) => records.find((item) => item.id === id) ?? null),
    updateReviewStatus: vi.fn(async ({ id, reviewStatus }) => ({ ok: true, evidence: { id, humanReviewStatus: reviewStatus } })),
  }
}

function remediationRepository() {
  const records = []
  return {
    connected: false,
    create: vi.fn(async (plan) => { records.push(plan); return { ok: true, plan } }),
    list: vi.fn(async () => records),
    get: vi.fn(async ({ id }) => records.find((item) => item.id === id) ?? null),
    updateApproval: vi.fn(async ({ id, approvalStatus }) => ({ ok: true, plan: { id, approvalStatus } })),
    updateExecution: vi.fn(async ({ id, executionStatus }) => ({ ok: true, plan: { id, executionStatus } })),
  }
}

function upstream() {
  const operatorAttention = prioritizeOperatorAttention({ tenantContext, notificationDigest, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
  const administrativeCases = buildAdministrativeCases({ tenantContext, operatorAttention }, { emitEvent: false })
  const administrativeEvidence = collectAdministrativeEvidence({ tenantContext, administrativeCases, operatorAttention, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
  const remediationPlanning = buildRemediationPlans({ tenantContext, administrativeEvidence, administrativeCases, operatorAttention }, { emitEvent: false })
  return { operatorAttention, administrativeCases, administrativeEvidence, remediationPlanning }
}

describe('Phase 32A administrative evidence workspace', () => {
  it('adds idempotent evidence and remediation migrations and parameterized evidence queries', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_administrative_evidence')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_remediation_plans')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAdministrativeEvidenceRepository({ database: { connected: true, query } })
    await repository.create({ id: 'evidence-1', tenantContext, evidenceType: 'audit' })
    await repository.list({ tenantContext, reviewStatus: 'awaiting_review' })
    await repository.get({ id: 'evidence-1', tenantContext })
    await repository.updateReviewStatus({ id: 'evidence-1', tenantContext, reviewStatus: 'reviewed' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('collects redacted evidence references and updates review status without sensitive payloads', async () => {
    const { operatorAttention, administrativeCases } = upstream()
    const evidence = collectAdministrativeEvidence({ tenantContext, administrativeCases, operatorAttention, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
    const created = await createAdministrativeEvidence({ evidence: evidence.administrativeEvidence[0] }, { repository: evidenceRepository(), emitEvent: false })
    const updated = await updateEvidenceReviewStatus({ id: 'evidence-1', tenantContext, reviewStatus: 'reviewed' }, { repository: evidenceRepository(), emitEvent: false })
    expect(evidence.eventType).toBe(SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT)
    expect(created.eventType).toBe(SYSTEM_ADMINISTRATIVE_EVIDENCE_COLLECTED_EVENT)
    expect(updated.eventType).toBe(SYSTEM_ADMINISTRATIVE_EVIDENCE_REVIEW_UPDATED_EVENT)
    expect(evidence.sensitiveMaterialExcluded).toBe(true)
    expect(JSON.stringify(evidence)).not.toMatch(/"tokenHash"|"ipAddress"|"secret"/)
  })

  it('serves owner/admin evidence APIs and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), evidenceRepository: evidenceRepository(), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const list = parseResponse(await createAdministrativeEvidenceHandler(options)(authEvent('GET')))
    const create = parseResponse(await createAdministrativeEvidenceHandler(options)(authEvent('POST', { evidence: { id: 'item-1', evidenceType: 'audit', safeSummary: 'Audit evidence.' } })))
    const update = parseResponse(await createEvidenceReviewStatusUpdateHandler(options)(authEvent('POST', { id: 'item-1', reviewStatus: 'reviewed' })))
    const denied = parseResponse(await createAdministrativeEvidenceHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([list.statusCode, create.statusCode, update.statusCode]).toEqual([200, 200, 200])
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 32B remediation planning foundation', () => {
  it('builds human-review remediation plans and uses parameterized repository queries', async () => {
    const { administrativeEvidence, administrativeCases, operatorAttention } = upstream()
    const plans = buildRemediationPlans({ tenantContext, administrativeEvidence, administrativeCases, operatorAttention }, { emitEvent: false })
    expect(plans.eventType).toBe(SYSTEM_REMEDIATION_PLAN_CREATED_EVENT)
    expect(plans.dashboardExecution).toBe(false)
    expect(plans.automaticSessionRevocation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createRemediationPlanRepository({ database: { connected: true, query } })
    await repository.create(plans.remediationPlans[0])
    await repository.list({ tenantContext, approvalStatus: 'draft' })
    await repository.get({ id: 'plan-1', tenantContext })
    await repository.updateApproval({ id: 'plan-1', tenantContext, approvalStatus: 'approved' })
    await repository.updateExecution({ id: 'plan-1', tenantContext, executionStatus: 'completed' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('creates and updates plans without executing destructive remediation', async () => {
    const { remediationPlanning } = upstream()
    const repository = remediationRepository()
    const created = await createRemediationPlan({ plan: remediationPlanning.remediationPlans[0] }, { repository, emitEvent: false })
    const approval = await updateRemediationPlanApproval({ id: 'plan-1', tenantContext, approvalStatus: 'approved' }, { repository, emitEvent: false })
    const execution = await updateRemediationPlanExecution({ id: 'plan-1', tenantContext, executionStatus: 'in_progress' }, { repository, emitEvent: false })
    expect(created.eventType).toBe(SYSTEM_REMEDIATION_PLAN_CREATED_EVENT)
    expect(approval.eventType).toBe(SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT)
    expect(execution.eventType).toBe(SYSTEM_REMEDIATION_PLAN_UPDATED_EVENT)
    expect(created.dashboardExecution).toBe(false)
  })

  it('serves owner/admin remediation APIs and denies analyst access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), remediationRepository: remediationRepository(), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const list = parseResponse(await createRemediationPlansHandler(options)(authEvent('GET')))
    const create = parseResponse(await createRemediationPlansHandler(options)(authEvent('POST', { plan: { id: 'item-1', planCategory: 'session review', priority: 'high' } })))
    const approval = parseResponse(await createRemediationPlanApprovalUpdateHandler(options)(authEvent('POST', { id: 'item-1', approvalStatus: 'approved' })))
    const status = parseResponse(await createRemediationPlanStatusUpdateHandler(options)(authEvent('POST', { id: 'item-1', executionStatus: 'in_progress' })))
    const denied = parseResponse(await createRemediationPlansHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([list.statusCode, create.statusCode, approval.statusCode, status.statusCode]).toEqual([200, 200, 200, 200])
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 32C investigation and remediation command center', () => {
  it('summarizes investigations, evidence, and plans without recalculating upstream payloads', () => {
    const { operatorAttention, administrativeCases, administrativeEvidence, remediationPlanning } = upstream()
    const commandCenter = evaluateInvestigationRemediationCommandCenter({
      administrativeCases,
      administrativeEvidence,
      remediationPlanning,
      operatorAttention,
      tenantAdministrationOperations: { eventType: 'system.tenantAdministrationOperations.evaluated', operationalStatus: 'healthy' },
    }, { emitEvent: false })
    expect(commandCenter.eventType).toBe(SYSTEM_INVESTIGATION_REMEDIATION_COMMAND_CENTER_EVALUATED_EVENT)
    expect(commandCenter.openInvestigations).toBeGreaterThan(0)
    expect(commandCenter.evidenceAwaitingReview).toBeGreaterThan(0)
    expect(commandCenter.safeSummariesOnly).toBe(true)
    expect(commandCenter.destructiveActionsEnabled).toBe(false)
  })

  it('serves investigation remediation health endpoint safely', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createInvestigationRemediationHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createInvestigationRemediationHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.safeSummariesOnly).toBe(true)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(owner.json)).not.toMatch(/"tokenHash"|"ipAddress"|"secret"/)
  })
})
