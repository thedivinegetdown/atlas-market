import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { prioritizeOperatorAttention } from '../lib/system/operatorAttentionPrioritizationEngine.js'
import { buildAdministrativeCases } from '../lib/system/administrativeCaseManagementEngine.js'
import { collectAdministrativeEvidence } from '../lib/system/administrativeEvidenceEngine.js'
import { buildRemediationPlans } from '../lib/system/remediationPlanningEngine.js'
import {
  SYSTEM_EVIDENCE_GOVERNANCE_REVIEWED_EVENT,
  createEvidenceGovernanceRepository,
  evaluateEvidenceGovernance,
} from '../lib/system/evidenceGovernanceEngine.js'
import {
  SYSTEM_REMEDIATION_EFFECTIVENESS_REVIEWED_EVENT,
  createRemediationEffectivenessRepository,
  evaluateRemediationEffectiveness,
} from '../lib/system/remediationEffectivenessEngine.js'
import {
  SYSTEM_ADMINISTRATIVE_GOVERNANCE_COMMAND_CENTER_EVALUATED_EVENT,
  evaluateAdministrativeGovernanceCommandCenter,
} from '../lib/system/administrativeGovernanceCommandCenterEngine.js'
import { evaluateInvestigationRemediationCommandCenter } from '../lib/system/investigationRemediationCommandCenterEngine.js'
import { createEvidenceGovernanceReviewHandler } from '../netlify/functions/evidence-governance-review.js'
import { createEvidenceGovernanceHealthHandler } from '../netlify/functions/evidence-governance-health.js'
import { createRemediationEffectivenessReviewHandler } from '../netlify/functions/remediation-effectiveness-review.js'
import { createRemediationFollowUpReviewHandler } from '../netlify/functions/remediation-follow-up-review.js'
import { createAdministrativeGovernanceHealthHandler } from '../netlify/functions/administrative-governance-health.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }
const notificationDigest = { eventType: 'system.notificationDigest.generated', normalizedNotificationDigest: { unreadCount: 4, criticalCount: 1 } }
const userActivityRiskReview = { eventType: 'system.userActivityRiskReview.evaluated', activityRiskFindings: [{ id: 'risk-1', severity: 'high', summary: 'Repeated privileged access review finding.', references: ['activity-1'] }] }
const administrationWorkflowSla = { eventType: 'system.administrationWorkflowSla.evaluated', workflowSlaItems: [{ workflowId: 'workflow-1', category: 'session review', priority: 'high', slaStatus: 'breached', escalationPlanning: 'owner/admin review recommended' }] }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', role = 'owner') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase32def',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', limit: '25' },
    body: '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'owner') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function upstream() {
  const operatorAttention = prioritizeOperatorAttention({ tenantContext, notificationDigest, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
  const administrativeCases = buildAdministrativeCases({ tenantContext, operatorAttention }, { emitEvent: false })
  const administrativeEvidence = collectAdministrativeEvidence({ tenantContext, administrativeCases, operatorAttention, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
  const remediationPlanning = buildRemediationPlans({ tenantContext, administrativeEvidence, administrativeCases, operatorAttention }, { emitEvent: false })
  const investigationRemediationCommandCenter = evaluateInvestigationRemediationCommandCenter({ administrativeCases, administrativeEvidence, remediationPlanning, operatorAttention }, { emitEvent: false })
  return { operatorAttention, administrativeCases, administrativeEvidence, remediationPlanning, investigationRemediationCommandCenter }
}

describe('Phase 32D evidence governance, integrity, and retention', () => {
  it('adds idempotent governance/effectiveness migrations and parameterized governance repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_evidence_governance_evaluations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_remediation_effectiveness_evaluations')
    expect(sql).toContain('idx_atlas_evidence_governance_retention')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createEvidenceGovernanceRepository({ database: { connected: true, query } })
    await repository.create({ evidence: upstream().administrativeEvidence.administrativeEvidence[0] })
    await repository.list({ tenantContext, governanceStatus: 'review_required' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates evidence by reference without sensitive source payload copies or deletion', () => {
    const { administrativeEvidence, administrativeCases } = upstream()
    const governance = evaluateEvidenceGovernance({ administrativeEvidence, administrativeCases }, { emitEvent: false, timestamp: '2026-07-10T13:00:00.000Z' })
    expect(governance.eventType).toBe(SYSTEM_EVIDENCE_GOVERNANCE_REVIEWED_EVENT)
    expect(governance.evidenceGovernanceEvaluations.length).toBeGreaterThan(0)
    expect(governance.preservesEvidenceByReference).toBe(true)
    expect(governance.automaticDeletion).toBe(false)
    expect(governance.automaticRetentionMutation).toBe(false)
    expect(JSON.stringify(governance)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })

  it('serves owner/admin governance APIs and denies viewer access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const review = parseResponse(await createEvidenceGovernanceReviewHandler(options)(authEvent('GET')))
    const health = parseResponse(await createEvidenceGovernanceHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createEvidenceGovernanceReviewHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', 'viewer')))
    expect([review.statusCode, health.statusCode]).toEqual([200, 200])
    expect(review.json.data.governance.safeSummariesOnly).toBe(true)
    expect(health.json.data.automaticDeletion).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 32E remediation effectiveness and follow-up intelligence', () => {
  it('evaluates remediation effectiveness without enforcement or access mutation', async () => {
    const { administrativeEvidence, administrativeCases, remediationPlanning, operatorAttention } = upstream()
    const effectiveness = evaluateRemediationEffectiveness({ remediationPlanning, administrativeEvidence, administrativeCases, operatorAttention, administrationWorkflowSla }, { emitEvent: false, timestamp: '2026-07-10T13:01:00.000Z' })
    expect(effectiveness.eventType).toBe(SYSTEM_REMEDIATION_EFFECTIVENESS_REVIEWED_EVENT)
    expect(effectiveness.remediationEffectivenessEvaluations.length).toBeGreaterThan(0)
    expect(effectiveness.automaticCaseReopen).toBe(false)
    expect(effectiveness.automaticEnforcementActions).toBe(false)
    expect(effectiveness.automaticRoleChanges).toBe(false)

    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createRemediationEffectivenessRepository({ database: { connected: true, query } })
    await repository.create(effectiveness.remediationEffectivenessEvaluations[0])
    await repository.list({ tenantContext, effectivenessRating: 'pending_evaluation' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves owner/admin effectiveness and follow-up APIs and denies analyst access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const review = parseResponse(await createRemediationEffectivenessReviewHandler(options)(authEvent('GET')))
    const followUp = parseResponse(await createRemediationFollowUpReviewHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createRemediationEffectivenessReviewHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', 'analyst')))
    expect([review.statusCode, followUp.statusCode]).toEqual([200, 200])
    expect(review.json.data.effectiveness.recommendationsOnly).toBe(true)
    expect(followUp.json.data.automaticEnforcementActions).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 32F administrative governance and effectiveness command center', () => {
  it('summarizes governance and effectiveness outputs without recalculating or destructive actions', () => {
    const source = upstream()
    const evidenceGovernance = evaluateEvidenceGovernance(source, { emitEvent: false })
    const remediationEffectiveness = evaluateRemediationEffectiveness(source, { emitEvent: false })
    const commandCenter = evaluateAdministrativeGovernanceCommandCenter({
      evidenceGovernance,
      remediationEffectiveness,
      tenantAdministrationOperations: { eventType: 'system.tenantAdministrationOperations.evaluated', operationalStatus: 'healthy' },
      operatorIntelligenceCommandCenter: { eventType: 'system.operatorIntelligenceCommandCenter.evaluated', commandCenterStatus: 'caution' },
      investigationRemediationCommandCenter: source.investigationRemediationCommandCenter,
    }, { emitEvent: false })
    expect(commandCenter.eventType).toBe(SYSTEM_ADMINISTRATIVE_GOVERNANCE_COMMAND_CENTER_EVALUATED_EVENT)
    expect(commandCenter.evidenceRequiringReview).toBeGreaterThanOrEqual(0)
    expect(commandCenter.safeSummariesOnly).toBe(true)
    expect(commandCenter.destructiveActionsEnabled).toBe(false)
    expect(commandCenter.automaticEvidenceDeletion).toBe(false)
    expect(commandCenter.automaticRemediationEnforcement).toBe(false)
  })

  it('serves administrative governance health safely for owners/admins only', async () => {
    const source = upstream()
    const evidenceGovernance = evaluateEvidenceGovernance(source, { emitEvent: false })
    const remediationEffectiveness = evaluateRemediationEffectiveness(source, { emitEvent: false })
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...source, evidenceGovernance, remediationEffectiveness, env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createAdministrativeGovernanceHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createAdministrativeGovernanceHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', 'viewer')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.commandCenter.safeSummariesOnly).toBe(true)
    expect(owner.json.data.commandCenter.liveOrders).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(owner.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
  })
})
