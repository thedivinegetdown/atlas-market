import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { normalizeNotificationPreferences } from '../lib/system/notificationPreferenceService.js'
import { normalizeInAppNotification } from '../lib/system/inAppNotificationService.js'
import {
  SYSTEM_NOTIFICATION_DIGEST_GENERATED_EVENT,
  createNotificationDigestRepository,
  generateNotificationDigest,
  normalizeNotificationDigest,
} from '../lib/system/notificationDigestEngine.js'
import {
  SYSTEM_USER_ACTIVITY_RISK_REVIEW_EVALUATED_EVENT,
  evaluateUserActivityRiskReview,
} from '../lib/system/userActivityRiskReviewEngine.js'
import {
  SYSTEM_ADMINISTRATION_WORKFLOW_SLA_EVALUATED_EVENT,
  evaluateAdministrationWorkflowSla,
} from '../lib/system/administrationWorkflowSlaEngine.js'
import { evaluateUserActivityTimeline } from '../lib/system/userActivityTimelineService.js'
import { evaluateTenantAdministrationWorkflow } from '../lib/system/tenantAdministrationWorkflowEngine.js'
import { createNotificationDigestHandler } from '../netlify/functions/notification-digest.js'
import { createUserActivityRiskReviewHandler } from '../netlify/functions/user-activity-risk-review.js'
import { createWorkflowSlaReviewHandler } from '../netlify/functions/workflow-sla-review.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(role = 'owner') {
  return {
    httpMethod: 'GET',
    headers: {
      authorization: 'Bearer dev-token',
      'x-request-id': 'req-phase31',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', frequency: 'hourly' },
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
    getMembership: vi.fn(async () => ({
      id: `membership-${role}`,
      organizationId: 'org-atlas-local',
      userId,
      role,
      status: 'active',
    })),
  }
}

function notificationRepository(notifications = []) {
  return {
    connected: false,
    list: vi.fn(async () => notifications),
  }
}

function preferenceRepository(preferences = normalizeNotificationPreferences({ userId })) {
  return {
    getPreferences: vi.fn(async () => preferences),
  }
}

function digestRepository() {
  return {
    connected: false,
    save: vi.fn(async (digest) => ({ ok: true, digest })),
    list: vi.fn(async () => []),
  }
}

describe('Phase 31A notification digest engine', () => {
  it('adds idempotent digest persistence migration and keeps existing migrations safe', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_notification_digests')
    expect(sql).toContain('idx_atlas_notification_digests_user_created')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
  })

  it('generates preference-aware in-app digests without external delivery', async () => {
    const preferences = normalizeNotificationPreferences({
      userId,
      categories: {
        security: { enabled: true, severityThreshold: 'critical', channels: { inApp: true } },
        collaboration: { enabled: false, channels: { inApp: false } },
      },
    })
    const notifications = [
      normalizeInAppNotification({ id: 'critical-security', userId, tenantContext, category: 'security', severity: 'critical', status: 'unread' }),
      normalizeInAppNotification({ id: 'hidden-collaboration', userId, tenantContext, category: 'collaboration', severity: 'high', status: 'unread' }),
    ]
    const digest = await generateNotificationDigest({ tenantContext, userId, notifications, preferences, frequency: 'hourly' }, {
      repository: digestRepository(),
      emitEvent: false,
    })
    expect(digest.eventType).toBe(SYSTEM_NOTIFICATION_DIGEST_GENERATED_EVENT)
    expect(digest.normalizedNotificationDigest.notificationCount).toBe(1)
    expect(digest.criticalSecurityVisible).toBe(true)
    expect(digest.externalDelivery).toBe(false)
  })

  it('uses parameterized digest repository queries and serves digest API safely', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createNotificationDigestRepository({ database: { connected: true, query } })
    await repository.save(normalizeNotificationDigest({ tenantContext, userId, frequency: 'daily' }))
    await repository.list({ tenantContext, userId })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)

    const response = parseResponse(await createNotificationDigestHandler({
      repositoryFactory,
      organizationMembershipRepository: membershipRepository('owner'),
      notificationRepository: notificationRepository([normalizeInAppNotification({ id: 'notice-1', userId, tenantContext, category: 'security', severity: 'critical' })]),
      preferenceRepository: preferenceRepository(),
      digestRepository: digestRepository(),
      env: { TRADING_MODE: 'paper' },
    })(authEvent('owner')))
    expect(response.statusCode).toBe(200)
    expect(response.json.data.externalDelivery).toBe(false)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"secret"|"ipAddress"/)
  })
})

describe('Phase 31B user activity risk review', () => {
  it('reuses redacted activity timeline and avoids automatic actions', () => {
    const timeline = evaluateUserActivityTimeline({
      tenantContext,
      requester: { id: userId, role: 'owner' },
      targetUserId: userId,
      sessions: [{ id: 'session-1', userId, status: 'expired', tokenHash: 'hidden', ipAddress: 'hidden' }],
      administrativeAuditRecords: [{ id: 'audit-1', category: 'organization', actor: userId, tenantScope: tenantContext }],
    }, { emitEvent: false })
    const review = evaluateUserActivityRiskReview({
      timeline,
      notifications: [normalizeInAppNotification({ id: 'critical-security', userId, tenantContext, category: 'security', severity: 'critical' })],
    }, { emitEvent: false })
    expect(review.eventType).toBe(SYSTEM_USER_ACTIVITY_RISK_REVIEW_EVALUATED_EVENT)
    expect(review.activityRiskStatus).toBe('caution')
    expect(review.sensitiveFieldRedactionVerified).toBe(true)
    expect(review.automaticSessionRevocation).toBe(false)
    expect(review.automaticTradingActions).toBe(false)
    expect(JSON.stringify(timeline.normalizedActivityRecords)).not.toMatch(/tokenHash|ipAddress/)
  })

  it('serves user activity risk API within authenticated tenant context', async () => {
    const response = parseResponse(await createUserActivityRiskReviewHandler({
      repositoryFactory,
      organizationMembershipRepository: membershipRepository('owner'),
      sessions: [{ id: 'session-1', userId, status: 'active' }],
      notifications: [normalizeInAppNotification({ id: 'notice-1', userId, tenantContext, category: 'security', severity: 'critical' })],
      env: { TRADING_MODE: 'paper' },
    })(authEvent('owner')))
    expect(response.statusCode).toBe(200)
    expect(response.json.data.automaticTradingActions).toBe(false)
    expect(response.json.data.review.eventType).toBe(SYSTEM_USER_ACTIVITY_RISK_REVIEW_EVALUATED_EVENT)
  })
})

describe('Phase 31C workflow SLA and escalation planning', () => {
  it('evaluates due-soon and breached workflow SLA without mutating workflows', () => {
    const workflow = evaluateTenantAdministrationWorkflow({
      tenantContext,
      existingWorkflows: [{
        id: 'workflow-critical-old',
        tenantContext,
        category: 'session review',
        priority: 'high',
        status: 'open',
        createdAt: '2026-07-10T00:00:00.000Z',
      }],
    }, { emitEvent: false, timestamp: '2026-07-10T00:00:00.000Z' })
    const sla = evaluateAdministrationWorkflowSla({ tenantAdministrationWorkflow: workflow }, {
      emitEvent: false,
      now: '2026-07-10T12:00:00.000Z',
    })
    expect(sla.eventType).toBe(SYSTEM_ADMINISTRATION_WORKFLOW_SLA_EVALUATED_EVENT)
    expect(sla.workflowSlaStatus).toBe('blocked')
    expect(sla.workflowSlaSummary.breached).toBe(1)
    expect(sla.escalationPlanningOnly).toBe(true)
    expect(sla.automaticWorkflowMutation).toBe(false)
  })

  it('serves owner/admin workflow SLA API and denies analyst access', async () => {
    const owner = parseResponse(await createWorkflowSlaReviewHandler({
      repositoryFactory,
      organizationMembershipRepository: membershipRepository('owner'),
      workflows: [{ id: 'workflow-1', tenantContext, category: 'session review', priority: 'low', status: 'open' }],
      env: { TRADING_MODE: 'paper' },
    })(authEvent('owner')))
    const denied = parseResponse(await createWorkflowSlaReviewHandler({
      repositoryFactory,
      organizationMembershipRepository: membershipRepository('analyst'),
      workflows: [{ id: 'workflow-1', tenantContext, category: 'session review', priority: 'low', status: 'open' }],
      env: { TRADING_MODE: 'paper' },
    })(authEvent('analyst')))
    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.escalationPlanningOnly).toBe(true)
    expect(denied.statusCode).toBe(403)
  })
})
