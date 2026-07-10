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
import { SYSTEM_COMPLIANCE_REVIEW_CALENDAR_GENERATED_EVENT, createComplianceReviewCalendarRepository, generateComplianceReviewCalendar } from '../lib/system/complianceReviewCalendarEngine.js'
import { SYSTEM_COMPLIANCE_ATTESTATION_RENEWAL_PLANNED_EVENT, createComplianceAttestationRenewalRepository, planComplianceAttestationRenewals } from '../lib/system/complianceAttestationRenewalPlannerEngine.js'
import { SYSTEM_COMPLIANCE_GOVERNANCE_READOUT_PREPARED_EVENT, createComplianceGovernanceReadoutRepository, prepareComplianceGovernanceReadout } from '../lib/system/complianceGovernanceReadoutEngine.js'
import { createComplianceReviewCalendarHandler } from '../netlify/functions/compliance-review-calendar.js'
import { createComplianceAttestationRenewalsHandler } from '../netlify/functions/compliance-attestation-renewals.js'
import { createComplianceGovernanceReadoutsHandler } from '../netlify/functions/compliance-governance-readouts.js'

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
      'x-request-id': 'req-phase37abc',
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
  return { policyAttestation, complianceReviewWorkflow, complianceReviewSla, complianceEscalationPlanning, complianceRiskCommandCenter, complianceReviewCalendar, complianceAttestationRenewalPlanning, complianceGovernanceReadout, complianceObligationMapping }
}

describe('Phase 37A compliance review calendar', () => {
  it('adds idempotent calendar/renewal/readout migrations and parameterized calendar access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_review_calendar_items')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_attestation_renewals')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_governance_readouts')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceReviewCalendarRepository({ database: { connected: true, query } })
    await repository.create({ id: 'calendar-1', tenantContext, itemType: 'sla-review' })
    await repository.list({ tenantContext, itemStatus: 'due_soon', itemType: 'sla-review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('generates review calendar without automatic scheduling', () => {
    const source = upstream()
    expect(source.complianceReviewCalendar.eventType).toBe(SYSTEM_COMPLIANCE_REVIEW_CALENDAR_GENERATED_EVENT)
    expect(source.complianceReviewCalendar.automaticScheduling).toBe(false)
    expect(source.complianceReviewCalendar.automaticComplianceClaims).toBe(false)
  })
})

describe('Phase 37B compliance attestation renewal planning', () => {
  it('plans renewals without automatic attestation or renewal', async () => {
    const source = upstream()
    expect(source.complianceAttestationRenewalPlanning.eventType).toBe(SYSTEM_COMPLIANCE_ATTESTATION_RENEWAL_PLANNED_EVENT)
    expect(source.complianceAttestationRenewalPlanning.automaticRenewal).toBe(false)
    expect(source.complianceAttestationRenewalPlanning.automaticAttestation).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceAttestationRenewalRepository({ database: { connected: true, query } })
    await repository.create({ id: 'renewal-1', tenantContext, renewalStatus: 'due_soon' })
    await repository.list({ tenantContext, renewalStatus: 'due_soon' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves owner/admin calendar and renewal APIs and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const calendar = parseResponse(await createComplianceReviewCalendarHandler(options)(authEvent('GET')))
    const createCalendar = parseResponse(await createComplianceReviewCalendarHandler(options)(authEvent('POST', { calendarItem: { id: 'calendar-1' } })))
    const renewals = parseResponse(await createComplianceAttestationRenewalsHandler(options)(authEvent('GET')))
    const createRenewal = parseResponse(await createComplianceAttestationRenewalsHandler(options)(authEvent('POST', { renewal: { id: 'renewal-1' } })))
    const denied = parseResponse(await createComplianceReviewCalendarHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([calendar.statusCode, createCalendar.statusCode, renewals.statusCode, createRenewal.statusCode]).toEqual([200, 200, 200, 200])
    expect(calendar.json.data.complianceReviewCalendar.automaticScheduling).toBe(false)
    expect(renewals.json.data.complianceAttestationRenewalPlanning.automaticRenewal).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 37C compliance governance readout', () => {
  it('prepares governance readouts without distribution or compliance claims', async () => {
    const source = upstream()
    expect(source.complianceGovernanceReadout.eventType).toBe(SYSTEM_COMPLIANCE_GOVERNANCE_READOUT_PREPARED_EVENT)
    expect(source.complianceGovernanceReadout.automaticDistribution).toBe(false)
    expect(source.complianceGovernanceReadout.automaticComplianceClaims).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceGovernanceReadoutRepository({ database: { connected: true, query } })
    await repository.create({ id: 'readout-1', tenantContext, readoutStatus: 'ready_for_review' })
    await repository.list({ tenantContext, readoutStatus: 'ready_for_review' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves readout APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const readouts = parseResponse(await createComplianceGovernanceReadoutsHandler(options)(authEvent('GET')))
    const createReadout = parseResponse(await createComplianceGovernanceReadoutsHandler(options)(authEvent('POST', { readout: { id: 'readout-1' } })))
    const denied = parseResponse(await createComplianceGovernanceReadoutsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([readouts.statusCode, createReadout.statusCode]).toEqual([200, 200])
    expect(readouts.json.data.complianceGovernanceReadout.automaticDistribution).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(readouts.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
