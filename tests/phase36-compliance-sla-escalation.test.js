import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateAdministrativePolicyGovernance } from '../lib/system/administrativePolicyGovernanceEngine.js'
import { evaluateControlAssurance } from '../lib/system/controlAssuranceEngine.js'
import { evaluatePolicyControlAssuranceCommandCenter } from '../lib/system/policyControlAssuranceCommandCenterEngine.js'
import { evaluatePolicyAttestations } from '../lib/system/policyAttestationEngine.js'
import { evaluateControlTesting } from '../lib/system/controlTestingEngine.js'
import { evaluateComplianceReadinessCommandCenter } from '../lib/system/complianceReadinessCommandCenterEngine.js'
import { prepareComplianceEvidencePackage } from '../lib/system/complianceEvidencePackageEngine.js'
import { evaluateComplianceReviewWorkflow } from '../lib/system/complianceReviewWorkflowEngine.js'
import { evaluateComplianceOperationsCommandCenter } from '../lib/system/complianceOperationsCommandCenterEngine.js'
import { evaluateComplianceObligationMapping } from '../lib/system/complianceObligationMappingEngine.js'
import { queueComplianceEvidenceRequests } from '../lib/system/complianceEvidenceRequestQueueEngine.js'
import { trackComplianceReviewFindings } from '../lib/system/complianceReviewFindingTrackerEngine.js'
import {
  SYSTEM_COMPLIANCE_REVIEW_SLA_EVALUATED_EVENT,
  createComplianceReviewSlaRepository,
  evaluateComplianceReviewSla,
} from '../lib/system/complianceReviewSlaEngine.js'
import {
  SYSTEM_COMPLIANCE_ESCALATION_PLANNED_EVENT,
  SYSTEM_COMPLIANCE_ESCALATION_UPDATED_EVENT,
  createComplianceEscalationPlanRepository,
  planComplianceEscalations,
  updateComplianceEscalationStatus,
} from '../lib/system/complianceEscalationPlanningEngine.js'
import {
  SYSTEM_COMPLIANCE_RISK_COMMAND_CENTER_EVALUATED_EVENT,
  evaluateComplianceRiskCommandCenter,
} from '../lib/system/complianceRiskCommandCenterEngine.js'
import { createComplianceReviewSlaHandler } from '../netlify/functions/compliance-review-sla.js'
import { createComplianceEscalationPlansHandler } from '../netlify/functions/compliance-escalation-plans.js'
import { createComplianceEscalationStatusUpdateHandler } from '../netlify/functions/compliance-escalation-status-update.js'
import { createComplianceRiskHealthHandler } from '../netlify/functions/compliance-risk-health.js'

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
      'x-request-id': 'req-phase36abc',
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
  const controlAssurance = evaluateControlAssurance({ policyGovernance }, { emitEvent: false })
  const policyControlAssuranceCommandCenter = evaluatePolicyControlAssuranceCommandCenter({ policyGovernance, controlAssurance }, { emitEvent: false })
  const policyAttestation = evaluatePolicyAttestations({ tenantContext, policyGovernance, controlAssurance }, { emitEvent: false })
  const controlTesting = evaluateControlTesting({ policyGovernance, controlAssurance }, { emitEvent: false })
  const complianceReadinessCommandCenter = evaluateComplianceReadinessCommandCenter({ policyAttestation, controlTesting, policyControlAssuranceCommandCenter }, { emitEvent: false })
  const complianceEvidencePackage = prepareComplianceEvidencePackage({ tenantContext, policyGovernance, controlAssurance, policyAttestation, controlTesting }, { emitEvent: false })
  const complianceReviewWorkflow = evaluateComplianceReviewWorkflow({ tenantContext, complianceEvidencePackage, complianceReadinessCommandCenter }, { emitEvent: false })
  const complianceOperationsCommandCenter = evaluateComplianceOperationsCommandCenter({ complianceEvidencePackage, complianceReviewWorkflow, complianceReadinessCommandCenter, policyControlAssuranceCommandCenter }, { emitEvent: false })
  const complianceObligationMapping = evaluateComplianceObligationMapping({ tenantContext, policyGovernance, controlAssurance, complianceEvidencePackage, complianceReadinessCommandCenter }, { emitEvent: false })
  const complianceEvidenceRequestQueue = queueComplianceEvidenceRequests({ tenantContext, complianceObligationMapping, complianceEvidencePackage, complianceReviewWorkflow }, { emitEvent: false })
  const complianceReviewFindingTracker = trackComplianceReviewFindings({ tenantContext, complianceObligationMapping, complianceEvidenceRequestQueue, complianceReviewWorkflow }, { emitEvent: false })
  const complianceReviewSla = evaluateComplianceReviewSla({ tenantContext, complianceReviewWorkflow, complianceEvidenceRequestQueue, complianceReviewFindingTracker }, { emitEvent: false })
  const complianceEscalationPlanning = planComplianceEscalations({ tenantContext, complianceReviewSla, complianceReviewFindingTracker, complianceEvidenceRequestQueue }, { emitEvent: false })
  return { complianceOperationsCommandCenter, complianceObligationMapping, complianceEvidenceRequestQueue, complianceReviewFindingTracker, complianceReviewSla, complianceEscalationPlanning }
}

describe('Phase 36A compliance review SLA engine', () => {
  it('adds idempotent SLA/escalation migrations and parameterized SLA repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_review_sla_evaluations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_escalation_plans')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceReviewSlaRepository({ database: { connected: true, query } })
    await repository.create({ id: 'sla-1', tenantContext, slaStatus: 'at_risk' })
    await repository.list({ tenantContext, slaStatus: 'at_risk' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates SLA status without automatic escalation or approval', () => {
    const source = upstream()
    expect(source.complianceReviewSla.eventType).toBe(SYSTEM_COMPLIANCE_REVIEW_SLA_EVALUATED_EVENT)
    expect(source.complianceReviewSla.automaticEscalation).toBe(false)
    expect(source.complianceReviewSla.automaticApproval).toBe(false)
    expect(source.complianceReviewSla.complianceReviewSlas.length).toBeGreaterThan(0)
  })
})

describe('Phase 36B compliance escalation planning engine', () => {
  it('plans and updates escalations without executing them automatically', async () => {
    const source = upstream()
    const escalationPlanning = planComplianceEscalations({
      tenantContext,
      complianceReviewSla: {
        eventType: source.complianceReviewSla.eventType,
        complianceReviewSlas: [{ id: 'sla-critical', tenantContext, slaStatus: 'breached', slaSeverity: 'critical' }],
      },
      complianceReviewFindingTracker: source.complianceReviewFindingTracker,
      complianceEvidenceRequestQueue: source.complianceEvidenceRequestQueue,
    }, { emitEvent: false })
    expect(escalationPlanning.eventType).toBe(SYSTEM_COMPLIANCE_ESCALATION_PLANNED_EVENT)
    expect(escalationPlanning.automaticEscalationExecution).toBe(false)
    expect(escalationPlanning.complianceEscalationPlans.length).toBeGreaterThan(0)

    const repository = { updateStatus: vi.fn(async ({ id, escalationStatus }) => ({ ok: true, plan: { id, escalationStatus } })) }
    const updated = await updateComplianceEscalationStatus({ id: 'escalation-1', tenantContext, escalationStatus: 'acknowledged' }, { repository, emitEvent: false })
    expect(updated.eventType).toBe(SYSTEM_COMPLIANCE_ESCALATION_UPDATED_EVENT)
    expect(updated.automaticEscalationExecution).toBe(false)

    const query = vi.fn(async () => ({ rows: [] }))
    const repo = createComplianceEscalationPlanRepository({ database: { connected: true, query } })
    await repo.create({ id: 'escalation-1', tenantContext, escalationStatus: 'planned' })
    await repo.list({ tenantContext, escalationStatus: 'planned' })
    await repo.updateStatus({ id: 'escalation-1', tenantContext, escalationStatus: 'acknowledged' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves owner/admin SLA and escalation APIs and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const slas = parseResponse(await createComplianceReviewSlaHandler(options)(authEvent('GET')))
    const createSla = parseResponse(await createComplianceReviewSlaHandler(options)(authEvent('POST', { sla: { id: 'sla-1' } })))
    const escalations = parseResponse(await createComplianceEscalationPlansHandler(options)(authEvent('GET')))
    const createEscalation = parseResponse(await createComplianceEscalationPlansHandler(options)(authEvent('POST', { escalationPlan: { id: 'escalation-1' } })))
    const updateEscalation = parseResponse(await createComplianceEscalationStatusUpdateHandler(options)(authEvent('POST', { id: 'escalation-1', escalationStatus: 'acknowledged' })))
    const denied = parseResponse(await createComplianceReviewSlaHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([slas.statusCode, createSla.statusCode, escalations.statusCode, createEscalation.statusCode, updateEscalation.statusCode]).toEqual([200, 200, 200, 200, 200])
    expect(slas.json.data.complianceReviewSla.automaticEscalation).toBe(false)
    expect(escalations.json.data.complianceEscalationPlanning.automaticEscalationExecution).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 36C compliance risk command center', () => {
  it('aggregates compliance risk signals without claims, approvals, or enforcement', () => {
    const source = upstream()
    const commandCenter = evaluateComplianceRiskCommandCenter(source, { emitEvent: false })
    expect(commandCenter.eventType).toBe(SYSTEM_COMPLIANCE_RISK_COMMAND_CENTER_EVALUATED_EVENT)
    expect(commandCenter.safeSummariesOnly).toBe(true)
    expect(commandCenter.automaticComplianceClaims).toBe(false)
    expect(commandCenter.automaticEscalationExecution).toBe(false)
    expect(commandCenter.liveOrders).toBe(false)
  })

  it('serves compliance risk health safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createComplianceRiskHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createComplianceRiskHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.commandCenter.automaticComplianceClaims).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(owner.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
