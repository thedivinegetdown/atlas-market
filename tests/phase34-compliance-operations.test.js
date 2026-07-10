import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateAdministrativePolicyGovernance } from '../lib/system/administrativePolicyGovernanceEngine.js'
import { evaluateControlAssurance } from '../lib/system/controlAssuranceEngine.js'
import { evaluatePolicyControlAssuranceCommandCenter } from '../lib/system/policyControlAssuranceCommandCenterEngine.js'
import { evaluatePolicyAttestations } from '../lib/system/policyAttestationEngine.js'
import { evaluateControlTesting } from '../lib/system/controlTestingEngine.js'
import { evaluateComplianceReadinessCommandCenter } from '../lib/system/complianceReadinessCommandCenterEngine.js'
import {
  SYSTEM_COMPLIANCE_EVIDENCE_PACKAGE_PREPARED_EVENT,
  createComplianceEvidencePackageRepository,
  prepareComplianceEvidencePackage,
} from '../lib/system/complianceEvidencePackageEngine.js'
import {
  SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_EVALUATED_EVENT,
  SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_UPDATED_EVENT,
  createComplianceReviewWorkflowRepository,
  evaluateComplianceReviewWorkflow,
  updateComplianceReviewWorkflowStatus,
} from '../lib/system/complianceReviewWorkflowEngine.js'
import {
  SYSTEM_COMPLIANCE_OPERATIONS_COMMAND_CENTER_EVALUATED_EVENT,
  evaluateComplianceOperationsCommandCenter,
} from '../lib/system/complianceOperationsCommandCenterEngine.js'
import { createComplianceEvidencePackagesHandler } from '../netlify/functions/compliance-evidence-packages.js'
import { createComplianceReviewWorkflowsHandler } from '../netlify/functions/compliance-review-workflows.js'
import { createComplianceReviewStatusUpdateHandler } from '../netlify/functions/compliance-review-status-update.js'
import { createComplianceOperationsHealthHandler } from '../netlify/functions/compliance-operations-health.js'

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
      'x-request-id': 'req-phase34def',
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
  return { policyGovernance, controlAssurance, policyControlAssuranceCommandCenter, policyAttestation, controlTesting, complianceReadinessCommandCenter, complianceEvidencePackage, complianceReviewWorkflow }
}

describe('Phase 34D compliance evidence package engine', () => {
  it('adds idempotent package/review migrations and parameterized package repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_evidence_packages')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_review_workflows')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceEvidencePackageRepository({ database: { connected: true, query } })
    await repository.create({ id: 'package-1', tenantContext })
    await repository.list({ tenantContext, packageStatus: 'ready_for_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares reference-only evidence packages without copying sensitive payloads', () => {
    const source = upstream()
    expect(source.complianceEvidencePackage.eventType).toBe(SYSTEM_COMPLIANCE_EVIDENCE_PACKAGE_PREPARED_EVENT)
    expect(source.complianceEvidencePackage.referenceOnly).toBe(true)
    expect(source.complianceEvidencePackage.sensitivePayloadCopied).toBe(false)
    expect(source.complianceEvidencePackage.automaticComplianceClaims).toBe(false)
  })
})

describe('Phase 34E compliance review workflow engine', () => {
  it('evaluates and updates review workflows without automatic approval', async () => {
    const source = upstream()
    expect(source.complianceReviewWorkflow.eventType).toBe(SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_EVALUATED_EVENT)
    expect(source.complianceReviewWorkflow.automaticApproval).toBe(false)
    const repository = {
      updateStatus: vi.fn(async ({ id, reviewStatus }) => ({ ok: true, workflow: { id, reviewStatus } })),
    }
    const updated = await updateComplianceReviewWorkflowStatus({ id: 'review-1', tenantContext, reviewStatus: 'in_review' }, { repository, emitEvent: false })
    expect(updated.eventType).toBe(SYSTEM_COMPLIANCE_REVIEW_WORKFLOW_UPDATED_EVENT)
    expect(updated.automaticApproval).toBe(false)

    const query = vi.fn(async () => ({ rows: [] }))
    const repo = createComplianceReviewWorkflowRepository({ database: { connected: true, query } })
    await repo.create(source.complianceReviewWorkflow.complianceReviewWorkflows[0])
    await repo.list({ tenantContext, reviewStatus: 'queued' })
    await repo.updateStatus({ id: 'review-1', tenantContext, reviewStatus: 'in_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves owner/admin package and review APIs and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const packages = parseResponse(await createComplianceEvidencePackagesHandler(options)(authEvent('GET')))
    const createPackage = parseResponse(await createComplianceEvidencePackagesHandler(options)(authEvent('POST', { evidencePackage: { id: 'package-1' } })))
    const workflows = parseResponse(await createComplianceReviewWorkflowsHandler(options)(authEvent('GET')))
    const update = parseResponse(await createComplianceReviewStatusUpdateHandler(options)(authEvent('POST', { id: 'review-1', reviewStatus: 'in_review' })))
    const denied = parseResponse(await createComplianceReviewWorkflowsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([packages.statusCode, createPackage.statusCode, workflows.statusCode, update.statusCode]).toEqual([200, 200, 200, 200])
    expect(packages.json.data.complianceEvidencePackage.sensitivePayloadCopied).toBe(false)
    expect(workflows.json.data.complianceReviewWorkflow.automaticApproval).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 34F compliance operations command center', () => {
  it('summarizes packages, reviews, and readiness without claims or automation', () => {
    const source = upstream()
    const commandCenter = evaluateComplianceOperationsCommandCenter(source, { emitEvent: false })
    expect(commandCenter.eventType).toBe(SYSTEM_COMPLIANCE_OPERATIONS_COMMAND_CENTER_EVALUATED_EVENT)
    expect(commandCenter.safeSummariesOnly).toBe(true)
    expect(commandCenter.automaticComplianceClaims).toBe(false)
    expect(commandCenter.automaticEvidenceExport).toBe(false)
    expect(commandCenter.liveOrders).toBe(false)
  })

  it('serves operations health safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createComplianceOperationsHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createComplianceOperationsHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.commandCenter.automaticComplianceClaims).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(owner.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
