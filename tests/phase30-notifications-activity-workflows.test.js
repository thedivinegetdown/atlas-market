import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { normalizeNotificationPreferences } from '../lib/system/notificationPreferenceService.js'
import {
  SYSTEM_IN_APP_NOTIFICATION_CREATED_EVENT,
  SYSTEM_IN_APP_NOTIFICATION_UPDATED_EVENT,
  createInAppNotification,
  createInAppNotificationRepository,
  evaluateNotificationPreference,
  updateInAppNotificationStatus,
} from '../lib/system/inAppNotificationService.js'
import {
  SYSTEM_USER_ACTIVITY_TIMELINE_EVALUATED_EVENT,
  evaluateUserActivityTimeline,
} from '../lib/system/userActivityTimelineService.js'
import {
  SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_CREATED_EVENT,
  SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_UPDATED_EVENT,
  createTenantAdministrationWorkflowRepository,
  evaluateTenantAdministrationWorkflow,
  updateTenantAdministrationWorkflowStatus,
} from '../lib/system/tenantAdministrationWorkflowEngine.js'
import { createInAppNotificationsHandler } from '../netlify/functions/in-app-notifications.js'
import { createNotificationStatusUpdateHandler } from '../netlify/functions/notification-status-update.js'
import { createCurrentUserActivityHandler } from '../netlify/functions/current-user-activity.js'
import { createTenantAdministrativeActivityHandler } from '../netlify/functions/tenant-administrative-activity.js'
import { createTenantAdministrationWorkflowsHandler } from '../netlify/functions/tenant-administration-workflows.js'
import { createWorkflowStatusUpdateHandler } from '../netlify/functions/workflow-status-update.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'owner', subject = 'local-operator') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase30d',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': subject,
    },
    queryStringParameters: { organizationId: 'org-atlas-local' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function createMockPersistenceRepository() {
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

function preferenceRepository(preferences = normalizeNotificationPreferences({ userId })) {
  return {
    getPreferences: vi.fn(async () => preferences),
  }
}

function notificationRepository() {
  const records = []
  return {
    connected: false,
    create: vi.fn(async (notification) => {
      records.push(notification)
      return { ok: true, notification }
    }),
    list: vi.fn(async () => records),
    updateStatus: vi.fn(async ({ id, status }) => ({ ok: true, notification: { id, status } })),
  }
}

function workflowRepository() {
  const records = []
  return {
    connected: false,
    upsert: vi.fn(async (workflow) => {
      records.push(workflow)
      return { ok: true, workflow }
    }),
    list: vi.fn(async () => records),
    updateStatus: vi.fn(async ({ id, status }) => ({ ok: true, workflow: { id, status } })),
  }
}

describe('Phase 30D in-app notification center', () => {
  it('adds idempotent notification and workflow migrations', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_in_app_notifications')
    expect(sql).toContain('idx_atlas_in_app_notifications_user_status_created')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_tenant_administration_workflows')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
  })

  it('applies preferences and quiet hours while keeping critical security notifications visible', async () => {
    const preferences = normalizeNotificationPreferences({
      userId,
      categories: {
        security: { enabled: true, severityThreshold: 'critical', channels: { inApp: true } },
        collaboration: { enabled: true, severityThreshold: 'caution', channels: { inApp: true } },
      },
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
    })
    const quietNow = new Date('2026-07-10T23:15:00')
    const critical = evaluateNotificationPreference({
      userId,
      tenantContext,
      category: 'security',
      severity: 'critical',
      title: 'Critical security',
    }, preferences, { now: quietNow })
    const collaboration = evaluateNotificationPreference({
      userId,
      tenantContext,
      category: 'collaboration',
      severity: 'caution',
      title: 'Collaboration review',
    }, preferences, { now: quietNow })
    expect(critical.visible).toBe(true)
    expect(critical.criticalSecurityVisible).toBe(true)
    expect(collaboration.visible).toBe(false)
    expect(collaboration.deferredByQuietHours).toBe(true)

    const created = await createInAppNotification({
      notification: { userId, tenantContext, category: 'security', severity: 'critical', title: 'Critical security' },
      preferences,
    }, {
      repository: notificationRepository(),
      now: quietNow,
      emitEvent: false,
    })
    expect(created.eventType).toBe(SYSTEM_IN_APP_NOTIFICATION_CREATED_EVENT)
    expect(created.status).toBe('created')
    expect(created.externalDelivery).toBe(false)
  })

  it('uses parameterized notification repository queries and updates notification status safely', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createInAppNotificationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'notification-1', userId, tenantContext, category: 'security', severity: 'critical' })
    await repository.list({ tenantContext, userId, status: 'unread' })
    await repository.updateStatus({ id: 'notification-1', tenantContext, userId, status: 'read' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)

    const update = await updateInAppNotificationStatus({ id: 'notification-1', tenantContext, userId, status: 'archived' }, {
      repository: notificationRepository(),
      emitEvent: false,
    })
    expect(update.eventType).toBe(SYSTEM_IN_APP_NOTIFICATION_UPDATED_EVENT)
    expect(update.status).toBe('updated')
  })

  it('serves notification APIs without external delivery or sensitive session material', async () => {
    const options = {
      repositoryFactory: () => createMockPersistenceRepository(),
      organizationMembershipRepository: membershipRepository('owner'),
      preferenceRepository: preferenceRepository(),
      notificationRepository: notificationRepository(),
      env: { TRADING_MODE: 'paper' },
    }
    const create = parseResponse(await createInAppNotificationsHandler(options)(authEvent('POST', {
      notification: { category: 'security', severity: 'critical', title: 'Security notice' },
    })))
    const list = parseResponse(await createInAppNotificationsHandler(options)(authEvent('GET')))
    const update = parseResponse(await createNotificationStatusUpdateHandler(options)(authEvent('POST', { id: 'notification-1', status: 'read' })))
    expect([create.statusCode, list.statusCode, update.statusCode]).toEqual([200, 200, 200])
    expect(create.json.data.externalDelivery).toBe(false)
    expect(JSON.stringify(list.json)).not.toMatch(/token_hash|ipAddress|rawToken/)
  })
})

describe('Phase 30E user activity and security timeline', () => {
  it('composes safe own-user activity and denies tenant administrative activity to analyst/viewer', async () => {
    const own = evaluateUserActivityTimeline({
      tenantContext,
      requester: { id: userId, role: 'viewer' },
      targetUserId: userId,
      sessions: [{ id: 'session-1', userId, status: 'active', tokenHash: 'hidden', ipAddress: 'hidden', userAgent: 'hidden' }],
      administrativeAuditRecords: [{ id: 'audit-1', category: 'session', actor: userId, tenantScope: tenantContext, before: { token: 'hidden' }, after: { status: 'active' } }],
      query: { limit: 10 },
    }, { emitEvent: false })
    const denied = evaluateUserActivityTimeline({
      tenantContext: { ...tenantContext, role: 'viewer' },
      requester: { id: userId, role: 'viewer' },
      administrative: true,
      administrativeAuditRecords: [{ id: 'audit-1', category: 'organization', actor: userId, tenantScope: tenantContext }],
    }, { emitEvent: false })
    expect(own.eventType).toBe(SYSTEM_USER_ACTIVITY_TIMELINE_EVALUATED_EVENT)
    expect(own.status).toBe('healthy')
    expect(JSON.stringify(own.normalizedActivityRecords)).not.toMatch(/tokenHash|ipAddress|userAgent/)
    expect(denied.status).toBe('blocked')
    expect(denied.access.analystViewerTenantAdminDenied).toBe(true)
  })

  it('serves current-user and owner/admin tenant activity APIs safely', async () => {
    const ownerOptions = {
      repositoryFactory: () => createMockPersistenceRepository(),
      organizationMembershipRepository: membershipRepository('owner'),
      sessions: [{ id: 'session-1', userId, status: 'active', tokenHash: 'hidden' }],
      env: { TRADING_MODE: 'paper' },
    }
    const analystOptions = {
      ...ownerOptions,
      organizationMembershipRepository: membershipRepository('analyst'),
    }
    const own = parseResponse(await createCurrentUserActivityHandler(ownerOptions)(authEvent('GET')))
    const tenant = parseResponse(await createTenantAdministrativeActivityHandler(ownerOptions)(authEvent('GET')))
    const denied = parseResponse(await createTenantAdministrativeActivityHandler(analystOptions)(authEvent('GET', {}, 'analyst')))
    expect([own.statusCode, tenant.statusCode]).toEqual([200, 200])
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(tenant.json)).not.toMatch(/"tokenHash"|"ipAddress"|"rawToken"/)
  })
})

describe('Phase 30F tenant administration workflow engine', () => {
  it('creates human-review workflows without destructive administration actions', async () => {
    const workflow = await evaluateTenantAdministrationWorkflow({
      tenantContext,
      accessReview: {
        eventType: 'system.accessReview.evaluated',
        reviewFindings: [{ id: 'stale-session-session-1', severity: 'caution', summary: 'Stale session requires review.' }],
      },
      accessCertification: { eventType: 'system.accessCertification.evaluated', certificationStatus: 'caution', summary: 'Certification requires review.' },
      notifications: [{ id: 'notification-1', status: 'unread', severity: 'critical', message: 'Security review.' }],
    }, {
      repository: workflowRepository(),
      emitEvent: false,
    })
    expect(workflow.eventType).toBe(SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_CREATED_EVENT)
    expect(workflow.workflowSummary.total).toBeGreaterThan(0)
    expect(workflow.humanReviewOnly).toBe(true)
    expect(workflow.automaticRoleChanges).toBe(false)
    expect(workflow.automaticMembershipRevocation).toBe(false)
    expect(workflow.automaticSessionRevocation).toBe(false)
    expect(workflow.automaticInvitationMutation).toBe(false)
  })

  it('uses parameterized workflow repository queries and updates workflow status safely', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createTenantAdministrationWorkflowRepository({ database: { connected: true, query } })
    await repository.upsert({ id: 'workflow-1', tenantContext, category: 'session review', status: 'open' })
    await repository.list({ tenantContext, status: 'open' })
    await repository.updateStatus({ id: 'workflow-1', tenantContext, status: 'acknowledged' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)

    const update = await updateTenantAdministrationWorkflowStatus({ id: 'workflow-1', tenantContext, status: 'resolved' }, {
      repository: workflowRepository(),
      emitEvent: false,
    })
    expect(update.eventType).toBe(SYSTEM_TENANT_ADMINISTRATION_WORKFLOW_UPDATED_EVENT)
    expect(update.status).toBe('updated')
  })

  it('serves owner/admin workflow APIs and denies analyst tenant-wide workflow access', async () => {
    const ownerOptions = {
      repositoryFactory: () => createMockPersistenceRepository(),
      organizationMembershipRepository: membershipRepository('owner'),
      workflowRepository: workflowRepository(),
      accessReview: { reviewFindings: [{ id: 'membership-review-1', severity: 'caution', summary: 'Membership review.' }] },
      env: { TRADING_MODE: 'paper' },
    }
    const analystOptions = {
      ...ownerOptions,
      organizationMembershipRepository: membershipRepository('analyst'),
    }
    const list = parseResponse(await createTenantAdministrationWorkflowsHandler(ownerOptions)(authEvent('GET')))
    const update = parseResponse(await createWorkflowStatusUpdateHandler(ownerOptions)(authEvent('POST', { id: 'workflow-1', status: 'acknowledged' })))
    const denied = parseResponse(await createTenantAdministrationWorkflowsHandler(analystOptions)(authEvent('GET', {}, 'analyst')))
    expect([list.statusCode, update.statusCode]).toEqual([200, 200])
    expect(denied.statusCode).toBe(403)
    expect(list.json.data.humanReviewOnly).toBe(true)
    expect(update.json.data.automaticDestructiveActions).toBe(false)
  })
})
