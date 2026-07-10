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
import { evaluateComplianceReviewSla } from '../lib/system/complianceReviewSlaEngine.js'
import { planComplianceEscalations } from '../lib/system/complianceEscalationPlanningEngine.js'
import { evaluateComplianceRiskCommandCenter } from '../lib/system/complianceRiskCommandCenterEngine.js'
import { generateComplianceReviewCalendar } from '../lib/system/complianceReviewCalendarEngine.js'
import { planComplianceAttestationRenewals } from '../lib/system/complianceAttestationRenewalPlannerEngine.js'
import { prepareComplianceGovernanceReadout } from '../lib/system/complianceGovernanceReadoutEngine.js'
import { SYSTEM_COMPLIANCE_AUDIT_READINESS_PREPARED_EVENT, createComplianceAuditReadinessPackageRepository, prepareComplianceAuditReadinessPackage } from '../lib/system/complianceAuditReadinessPackageEngine.js'
import { SYSTEM_COMPLIANCE_EXTERNAL_REVIEW_PLANNED_EVENT, createComplianceExternalReviewRequestRepository, planComplianceExternalReviews } from '../lib/system/complianceExternalReviewPlannerEngine.js'
import { SYSTEM_COMPLIANCE_GOVERNANCE_DECISION_RECORDED_EVENT, createComplianceGovernanceDecisionRepository, recordComplianceGovernanceDecisions } from '../lib/system/complianceGovernanceDecisionLogEngine.js'
import { createComplianceAuditReadinessPackagesHandler } from '../netlify/functions/compliance-audit-readiness-packages.js'
import { createComplianceExternalReviewRequestsHandler } from '../netlify/functions/compliance-external-review-requests.js'
import { createComplianceGovernanceDecisionsHandler } from '../netlify/functions/compliance-governance-decisions.js'

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
      'x-request-id': 'req-phase38abc',
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
  const policyAttestation = evaluatePolicyAttestations({ tenantContext, policyGovernance, controlAssurance }, { emitEvent: false, timestamp: '2026-07-10T13:00:00.000Z' })
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
  const complianceRiskCommandCenter = evaluateComplianceRiskCommandCenter({ complianceOperationsCommandCenter, complianceObligationMapping, complianceEvidenceRequestQueue, complianceReviewFindingTracker, complianceReviewSla, complianceEscalationPlanning }, { emitEvent: false })
  const complianceReviewCalendar = generateComplianceReviewCalendar({ tenantContext, complianceReviewWorkflow, complianceReviewSla, complianceEscalationPlanning }, { emitEvent: false })
  const complianceAttestationRenewalPlanning = planComplianceAttestationRenewals({ tenantContext, policyAttestation, complianceObligationMapping, complianceReviewCalendar }, { emitEvent: false })
  const complianceGovernanceReadout = prepareComplianceGovernanceReadout({ tenantContext, complianceRiskCommandCenter, complianceReviewCalendar, complianceAttestationRenewalPlanning, complianceEscalationPlanning }, { emitEvent: false })
  const complianceAuditReadinessPackage = prepareComplianceAuditReadinessPackage({ tenantContext, complianceEvidencePackage, complianceEvidenceRequestQueue, complianceReviewFindingTracker, complianceRiskCommandCenter, complianceGovernanceReadout }, { emitEvent: false })
  const complianceExternalReviewPlanning = planComplianceExternalReviews({ tenantContext, complianceAuditReadinessPackage, complianceGovernanceReadout, complianceReviewCalendar }, { emitEvent: false })
  const complianceGovernanceDecisionLog = recordComplianceGovernanceDecisions({ tenantContext, complianceAuditReadinessPackage, complianceExternalReviewPlanning, complianceGovernanceReadout, complianceEscalationPlanning }, { emitEvent: false })
  return {
    complianceEvidencePackage,
    complianceEvidenceRequestQueue,
    complianceReviewFindingTracker,
    complianceRiskCommandCenter,
    complianceReviewCalendar,
    complianceGovernanceReadout,
    complianceAuditReadinessPackage,
    complianceExternalReviewPlanning,
    complianceGovernanceDecisionLog,
    complianceEscalationPlanning,
  }
}

describe('Phase 38A compliance audit readiness packages', () => {
  it('adds idempotent audit/external-review/decision migrations and parameterized audit package access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_audit_readiness_packages')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_external_review_requests')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_governance_decisions')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceAuditReadinessPackageRepository({ database: { connected: true, query } })
    await repository.create({ id: 'audit-package-1', tenantContext, readinessStatus: 'ready_for_review' })
    await repository.list({ tenantContext, readinessStatus: 'ready_for_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares audit readiness packages without claims or exports', () => {
    const source = upstream()
    expect(source.complianceAuditReadinessPackage.eventType).toBe(SYSTEM_COMPLIANCE_AUDIT_READINESS_PREPARED_EVENT)
    expect(source.complianceAuditReadinessPackage.referenceOnly).toBe(true)
    expect(source.complianceAuditReadinessPackage.automaticComplianceClaims).toBe(false)
    expect(source.complianceAuditReadinessPackage.automaticExport).toBe(false)
  })
})

describe('Phase 38B compliance external review planning', () => {
  it('plans external review requests without automatic submission or distribution', async () => {
    const source = upstream()
    expect(source.complianceExternalReviewPlanning.eventType).toBe(SYSTEM_COMPLIANCE_EXTERNAL_REVIEW_PLANNED_EVENT)
    expect(source.complianceExternalReviewPlanning.automaticSubmission).toBe(false)
    expect(source.complianceExternalReviewPlanning.automaticDistribution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceExternalReviewRequestRepository({ database: { connected: true, query } })
    await repository.create({ id: 'external-review-1', tenantContext, requestStatus: 'ready_for_review', requestType: 'internal-review' })
    await repository.list({ tenantContext, requestStatus: 'ready_for_review', requestType: 'internal-review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves audit and external review APIs for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const auditPackages = parseResponse(await createComplianceAuditReadinessPackagesHandler(options)(authEvent('GET')))
    const createAuditPackage = parseResponse(await createComplianceAuditReadinessPackagesHandler(options)(authEvent('POST', { readinessPackage: { id: 'audit-package-1' } })))
    const externalReviews = parseResponse(await createComplianceExternalReviewRequestsHandler(options)(authEvent('GET')))
    const createExternalReview = parseResponse(await createComplianceExternalReviewRequestsHandler(options)(authEvent('POST', { reviewRequest: { id: 'external-review-1' } })))
    const denied = parseResponse(await createComplianceAuditReadinessPackagesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([auditPackages.statusCode, createAuditPackage.statusCode, externalReviews.statusCode, createExternalReview.statusCode]).toEqual([200, 200, 200, 200])
    expect(auditPackages.json.data.complianceAuditReadinessPackage.automaticExport).toBe(false)
    expect(externalReviews.json.data.complianceExternalReviewPlanning.automaticSubmission).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 38C compliance governance decision log', () => {
  it('records governance decision context without automatic approval or enforcement', async () => {
    const source = upstream()
    expect(source.complianceGovernanceDecisionLog.eventType).toBe(SYSTEM_COMPLIANCE_GOVERNANCE_DECISION_RECORDED_EVENT)
    expect(source.complianceGovernanceDecisionLog.humanReviewOnly).toBe(true)
    expect(source.complianceGovernanceDecisionLog.automaticApproval).toBe(false)
    expect(source.complianceGovernanceDecisionLog.automaticEnforcementActions).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceGovernanceDecisionRepository({ database: { connected: true, query } })
    await repository.create({ id: 'decision-1', tenantContext, decisionStatus: 'draft', decisionType: 'audit-readiness' })
    await repository.list({ tenantContext, decisionStatus: 'draft', decisionType: 'audit-readiness' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves decision log APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const decisions = parseResponse(await createComplianceGovernanceDecisionsHandler(options)(authEvent('GET')))
    const createDecision = parseResponse(await createComplianceGovernanceDecisionsHandler(options)(authEvent('POST', { decision: { id: 'decision-1' } })))
    const denied = parseResponse(await createComplianceGovernanceDecisionsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([decisions.statusCode, createDecision.statusCode]).toEqual([200, 200])
    expect(decisions.json.data.complianceGovernanceDecisionLog.automaticApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(decisions.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
