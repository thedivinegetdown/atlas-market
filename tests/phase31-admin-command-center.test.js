import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { prioritizeOperatorAttention } from '../lib/system/operatorAttentionPrioritizationEngine.js'
import {
  SYSTEM_ADMINISTRATIVE_CASE_CREATED_EVENT,
  SYSTEM_ADMINISTRATIVE_CASE_UPDATED_EVENT,
  buildAdministrativeCases,
  createAdministrativeCase,
  createAdministrativeCaseRepository,
  updateAdministrativeCaseStatus,
} from '../lib/system/administrativeCaseManagementEngine.js'
import {
  SYSTEM_OPERATOR_INTELLIGENCE_COMMAND_CENTER_EVALUATED_EVENT,
  evaluateOperatorIntelligenceCommandCenter,
} from '../lib/system/operatorIntelligenceCommandCenterEngine.js'
import { createOperatorAttentionQueueHandler } from '../netlify/functions/operator-attention-queue.js'
import { createAdministrativeCasesHandler } from '../netlify/functions/administrative-cases.js'
import { createAdministrativeCaseStatusUpdateHandler } from '../netlify/functions/administrative-case-status-update.js'
import { createOperatorIntelligenceHealthHandler } from '../netlify/functions/operator-intelligence-health.js'

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
      'x-request-id': 'req-phase31d',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', id: 'case-1' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return {
    connected: false,
    getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []), upsertScoped: vi.fn(async () => ({ ok: true })) })),
    end: vi.fn(async () => {}),
  }
}

function membershipRepository(role = 'owner') {
  return {
    getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })),
  }
}

function caseRepository() {
  const cases = []
  return {
    connected: false,
    create: vi.fn(async (administrativeCase) => {
      cases.push(administrativeCase)
      return { ok: true, case: administrativeCase }
    }),
    list: vi.fn(async () => cases),
    get: vi.fn(async ({ id }) => cases.find((item) => item.id === id) ?? null),
    updateStatus: vi.fn(async ({ id, status }) => ({ ok: true, case: { id, status } })),
  }
}

const notificationDigest = {
  eventType: 'system.notificationDigest.generated',
  normalizedNotificationDigest: { unreadCount: 4, criticalCount: 1 },
  status: 'caution',
}
const userActivityRiskReview = {
  eventType: 'system.userActivityRiskReview.evaluated',
  activityRiskStatus: 'caution',
  activityRiskFindings: [{ id: 'critical-notification-pressure', severity: 'high', summary: 'Critical notification remains visible.', references: ['notice-1'] }],
}
const administrationWorkflowSla = {
  eventType: 'system.administrationWorkflowSla.evaluated',
  workflowSlaSummary: { breached: 1, dueSoon: 0 },
  workflowSlaItems: [{ workflowId: 'workflow-1', category: 'session review', priority: 'high', slaStatus: 'breached', escalationPlanning: 'owner/admin review recommended', sourceFindingReferences: ['session-1'] }],
}

describe('Phase 31D operator attention prioritization', () => {
  it('ranks attention items from existing operator intelligence signals', () => {
    const result = prioritizeOperatorAttention({
      tenantContext,
      notificationDigest,
      userActivityRiskReview,
      administrationWorkflowSla,
      accessReview: { eventType: 'system.accessReview.evaluated', reviewFindings: [{ id: 'access-1', severity: 'caution', summary: 'Access review finding.' }] },
    }, { emitEvent: false })
    expect(result.eventType).toBe('system.operatorAttention.prioritized')
    expect(result.rankedOperatorAttentionQueue.length).toBeGreaterThan(0)
    expect(result.rankedOperatorAttentionQueue[0].priorityScore).toBeGreaterThanOrEqual(result.rankedOperatorAttentionQueue.at(-1).priorityScore)
    expect(result.humanReviewOnly).toBe(true)
    expect(result.automaticDestructiveActions).toBe(false)
  })

  it('serves owner/admin attention queue API and denies analyst access', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), notificationDigest, userActivityRiskReview, administrationWorkflowSla, env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createOperatorAttentionQueueHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createOperatorAttentionQueueHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.automaticDestructiveActions).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 31E administrative case management foundation', () => {
  it('adds idempotent administrative case migration and uses parameterized SQL', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_administrative_cases')
    expect(sql).toContain('idx_atlas_administrative_cases_tenant_status')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAdministrativeCaseRepository({ database: { connected: true, query } })
    await repository.create({ id: 'case-1', tenantContext, title: 'Case', priority: 'high' })
    await repository.list({ tenantContext })
    await repository.get({ id: 'case-1', tenantContext })
    await repository.updateStatus({ id: 'case-1', tenantContext, status: 'monitoring' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('groups attention items into human-review administrative cases', async () => {
    const operatorAttention = prioritizeOperatorAttention({ tenantContext, notificationDigest, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
    const cases = buildAdministrativeCases({ tenantContext, operatorAttention, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
    const created = await createAdministrativeCase({ case: cases.administrativeCases[0] }, { repository: caseRepository(), emitEvent: false })
    const updated = await updateAdministrativeCaseStatus({ id: 'case-1', tenantContext, status: 'resolved' }, { repository: caseRepository(), emitEvent: false })
    expect(cases.eventType).toBe(SYSTEM_ADMINISTRATIVE_CASE_CREATED_EVENT)
    expect(created.eventType).toBe(SYSTEM_ADMINISTRATIVE_CASE_CREATED_EVENT)
    expect(updated.eventType).toBe(SYSTEM_ADMINISTRATIVE_CASE_UPDATED_EVENT)
    expect(cases.automaticSessionRevocation).toBe(false)
    expect(cases.automaticMembershipRemoval).toBe(false)
  })

  it('serves administrative case APIs with owner/admin authorization', async () => {
    const repo = caseRepository()
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), caseRepository: repo, env: { TRADING_MODE: 'paper' } }
    const create = parseResponse(await createAdministrativeCasesHandler(options)(authEvent('POST', { case: { id: 'case-1', title: 'Review', priority: 'high' } })))
    const list = parseResponse(await createAdministrativeCasesHandler(options)(authEvent('GET')))
    const update = parseResponse(await createAdministrativeCaseStatusUpdateHandler(options)(authEvent('POST', { id: 'case-1', status: 'monitoring' })))
    const denied = parseResponse(await createAdministrativeCasesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([create.statusCode, list.statusCode, update.statusCode]).toEqual([200, 200, 200])
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(list.json)).not.toMatch(/"tokenHash"|"secret"|"ipAddress"/)
  })
})

describe('Phase 31F operator intelligence command center', () => {
  it('summarizes attention queue, cases, risk, digest, SLA, and tenant health safely', () => {
    const operatorAttention = prioritizeOperatorAttention({ tenantContext, notificationDigest, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
    const administrativeCases = buildAdministrativeCases({ tenantContext, operatorAttention }, { emitEvent: false })
    const commandCenter = evaluateOperatorIntelligenceCommandCenter({
      operatorAttention,
      administrativeCases,
      userActivityRiskReview,
      notificationDigest,
      administrationWorkflowSla,
      tenantAdministrationOperations: { eventType: 'system.tenantAdministrationOperations.evaluated', operationalStatus: 'healthy' },
    }, { emitEvent: false })
    expect(commandCenter.eventType).toBe(SYSTEM_OPERATOR_INTELLIGENCE_COMMAND_CENTER_EVALUATED_EVENT)
    expect(commandCenter.rankedAttentionQueueSummary.total).toBeGreaterThan(0)
    expect(commandCenter.openAdministrativeCases.total).toBeGreaterThan(0)
    expect(commandCenter.safeSummariesOnly).toBe(true)
    expect(commandCenter.liveOrders).toBe(false)
  })

  it('serves operator intelligence health endpoint and denies analyst/viewer access', async () => {
    const operatorAttention = prioritizeOperatorAttention({ tenantContext, notificationDigest, userActivityRiskReview, administrationWorkflowSla }, { emitEvent: false })
    const administrativeCases = buildAdministrativeCases({ tenantContext, operatorAttention }, { emitEvent: false })
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), operatorAttention, administrativeCases, userActivityRiskReview, notificationDigest, administrationWorkflowSla, env: { TRADING_MODE: 'paper' } }
    const owner = parseResponse(await createOperatorIntelligenceHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createOperatorIntelligenceHealthHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.safeSummariesOnly).toBe(true)
    expect(denied.statusCode).toBe(403)
  })
})
