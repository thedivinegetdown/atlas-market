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
import {
  SYSTEM_COMPLIANCE_OBLIGATION_MAPPING_EVALUATED_EVENT,
  createComplianceObligationRepository,
  evaluateComplianceObligationMapping,
} from '../lib/system/complianceObligationMappingEngine.js'
import {
  SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_QUEUED_EVENT,
  SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_UPDATED_EVENT,
  createComplianceEvidenceRequestRepository,
  queueComplianceEvidenceRequests,
  updateComplianceEvidenceRequestStatus,
} from '../lib/system/complianceEvidenceRequestQueueEngine.js'
import {
  SYSTEM_COMPLIANCE_REVIEW_FINDING_TRACKED_EVENT,
  SYSTEM_COMPLIANCE_REVIEW_FINDING_UPDATED_EVENT,
  createComplianceReviewFindingRepository,
  trackComplianceReviewFindings,
  updateComplianceReviewFindingStatus,
} from '../lib/system/complianceReviewFindingTrackerEngine.js'
import { createComplianceObligationsHandler } from '../netlify/functions/compliance-obligations.js'
import { createComplianceEvidenceRequestsHandler } from '../netlify/functions/compliance-evidence-requests.js'
import { createComplianceEvidenceRequestStatusUpdateHandler } from '../netlify/functions/compliance-evidence-request-status-update.js'
import { createComplianceReviewFindingsHandler } from '../netlify/functions/compliance-review-findings.js'
import { createComplianceReviewFindingStatusUpdateHandler } from '../netlify/functions/compliance-review-finding-status-update.js'

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
      'x-request-id': 'req-phase35abc',
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
  const complianceObligationMapping = evaluateComplianceObligationMapping({ tenantContext, policyGovernance, controlAssurance, complianceEvidencePackage, complianceReadinessCommandCenter }, { emitEvent: false })
  const complianceEvidenceRequestQueue = queueComplianceEvidenceRequests({ tenantContext, complianceObligationMapping, complianceEvidencePackage, complianceReviewWorkflow }, { emitEvent: false })
  const complianceReviewFindingTracker = trackComplianceReviewFindings({ tenantContext, complianceObligationMapping, complianceEvidenceRequestQueue, complianceReviewWorkflow }, { emitEvent: false })
  return { policyGovernance, controlAssurance, complianceReadinessCommandCenter, complianceEvidencePackage, complianceReviewWorkflow, complianceObligationMapping, complianceEvidenceRequestQueue, complianceReviewFindingTracker }
}

describe('Phase 35A compliance obligation mapping', () => {
  it('adds idempotent obligation/request/finding migrations and parameterized obligation repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_obligations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_evidence_requests')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_review_findings')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceObligationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'obligation-1', tenantContext })
    await repository.list({ tenantContext, obligationStatus: 'needs_evidence', obligationDomain: 'access governance' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('maps obligations as advisory coverage without compliance claims', () => {
    const source = upstream()
    expect(source.complianceObligationMapping.eventType).toBe(SYSTEM_COMPLIANCE_OBLIGATION_MAPPING_EVALUATED_EVENT)
    expect(source.complianceObligationMapping.advisoryOnly).toBe(true)
    expect(source.complianceObligationMapping.automaticComplianceClaims).toBe(false)
    expect(source.complianceObligationMapping.complianceObligations.length).toBeGreaterThan(0)
  })
})

describe('Phase 35B compliance evidence request queue', () => {
  it('queues and updates evidence requests without collection or export automation', async () => {
    const source = upstream()
    expect(source.complianceEvidenceRequestQueue.eventType).toBe(SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_QUEUED_EVENT)
    expect(source.complianceEvidenceRequestQueue.automaticEvidenceCollection).toBe(false)
    expect(source.complianceEvidenceRequestQueue.automaticEvidenceExport).toBe(false)

    const repository = { updateStatus: vi.fn(async ({ id, requestStatus }) => ({ ok: true, request: { id, requestStatus } })) }
    const updated = await updateComplianceEvidenceRequestStatus({ id: 'request-1', tenantContext, requestStatus: 'in_progress' }, { repository, emitEvent: false })
    expect(updated.eventType).toBe(SYSTEM_COMPLIANCE_EVIDENCE_REQUEST_UPDATED_EVENT)
    expect(updated.automaticEvidenceCollection).toBe(false)

    const query = vi.fn(async () => ({ rows: [] }))
    const repo = createComplianceEvidenceRequestRepository({ database: { connected: true, query } })
    await repo.create({ id: 'request-1', tenantContext, requestPriority: 'high' })
    await repo.list({ tenantContext, requestStatus: 'open', requestPriority: 'high' })
    await repo.updateStatus({ id: 'request-1', tenantContext, requestStatus: 'fulfilled' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves owner/admin obligation and evidence request APIs and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const obligations = parseResponse(await createComplianceObligationsHandler(options)(authEvent('GET')))
    const createObligation = parseResponse(await createComplianceObligationsHandler(options)(authEvent('POST', { obligation: { id: 'obligation-1' } })))
    const requests = parseResponse(await createComplianceEvidenceRequestsHandler(options)(authEvent('GET')))
    const createRequest = parseResponse(await createComplianceEvidenceRequestsHandler(options)(authEvent('POST', { evidenceRequest: { id: 'request-1' } })))
    const updateRequest = parseResponse(await createComplianceEvidenceRequestStatusUpdateHandler(options)(authEvent('POST', { id: 'request-1', requestStatus: 'in_progress' })))
    const denied = parseResponse(await createComplianceEvidenceRequestsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([obligations.statusCode, createObligation.statusCode, requests.statusCode, createRequest.statusCode, updateRequest.statusCode]).toEqual([200, 200, 200, 200, 200])
    expect(obligations.json.data.obligationMapping.automaticComplianceClaims).toBe(false)
    expect(requests.json.data.evidenceRequestQueue.automaticEvidenceExport).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 35C compliance review finding tracker', () => {
  it('tracks and updates review findings without automatic resolution', async () => {
    const source = upstream()
    expect(source.complianceReviewFindingTracker.eventType).toBe(SYSTEM_COMPLIANCE_REVIEW_FINDING_TRACKED_EVENT)
    expect(source.complianceReviewFindingTracker.automaticFindingResolution).toBe(false)
    expect(source.complianceReviewFindingTracker.automaticApproval).toBe(false)

    const repository = { updateStatus: vi.fn(async ({ id, findingStatus }) => ({ ok: true, finding: { id, findingStatus } })) }
    const updated = await updateComplianceReviewFindingStatus({ id: 'finding-1', tenantContext, findingStatus: 'acknowledged' }, { repository, emitEvent: false })
    expect(updated.eventType).toBe(SYSTEM_COMPLIANCE_REVIEW_FINDING_UPDATED_EVENT)
    expect(updated.automaticFindingResolution).toBe(false)

    const query = vi.fn(async () => ({ rows: [] }))
    const repo = createComplianceReviewFindingRepository({ database: { connected: true, query } })
    await repo.create({ id: 'finding-1', tenantContext, findingSeverity: 'caution' })
    await repo.list({ tenantContext, findingStatus: 'open', findingSeverity: 'caution' })
    await repo.updateStatus({ id: 'finding-1', tenantContext, findingStatus: 'acknowledged' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves review finding APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const findings = parseResponse(await createComplianceReviewFindingsHandler(options)(authEvent('GET')))
    const createFinding = parseResponse(await createComplianceReviewFindingsHandler(options)(authEvent('POST', { reviewFinding: { id: 'finding-1' } })))
    const updateFinding = parseResponse(await createComplianceReviewFindingStatusUpdateHandler(options)(authEvent('POST', { id: 'finding-1', findingStatus: 'acknowledged' })))
    const denied = parseResponse(await createComplianceReviewFindingsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([findings.statusCode, createFinding.statusCode, updateFinding.statusCode]).toEqual([200, 200, 200])
    expect(findings.json.data.reviewFindingTracker.automaticFindingResolution).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(findings.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
