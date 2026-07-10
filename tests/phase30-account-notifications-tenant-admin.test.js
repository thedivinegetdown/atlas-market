import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  SYSTEM_USER_ACCOUNT_UPDATED_EVENT,
  assertOwnProfileUpdate,
  createUserProfileRepository,
  normalizeUserProfile,
  updateUserAccount,
  validateUserProfile,
} from '../lib/auth/userAccountService.js'
import {
  NOTIFICATION_CATEGORIES,
  SYSTEM_NOTIFICATION_PREFERENCES_UPDATED_EVENT,
  createNotificationPreferenceRepository,
  normalizeNotificationPreferences,
  updateNotificationPreferences,
} from '../lib/system/notificationPreferenceService.js'
import {
  SYSTEM_TENANT_ADMINISTRATION_OPERATIONS_EVALUATED_EVENT,
  evaluateTenantAdministrationOperations,
} from '../lib/system/tenantAdministrationOperationsEngine.js'
import { createCurrentAccountHandler } from '../netlify/functions/current-account.js'
import { createAccountProfileUpdateHandler } from '../netlify/functions/account-profile-update.js'
import { createAccountHealthHandler } from '../netlify/functions/account-health.js'
import { createNotificationPreferencesHandler } from '../netlify/functions/notification-preferences.js'
import { createNotificationPreferencesUpdateHandler } from '../netlify/functions/notification-preferences-update.js'

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
      'x-request-id': 'req-phase30',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': subject,
    },
    queryStringParameters: {},
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function createMockPersistenceRepository() {
  return {
    getStore: vi.fn(() => ({ upsert: vi.fn(async () => ({ ok: true })) })),
    end: vi.fn(async () => {}),
  }
}

const userId = 'local-development:local-operator'

function profileRepository() {
  return {
    getProfile: vi.fn(async (id) => normalizeUserProfile({ userId: id })),
    upsertProfile: vi.fn(async (profile) => ({ ok: true, profile: normalizeUserProfile(profile) })),
  }
}

function preferenceRepository() {
  return {
    getPreferences: vi.fn(async (id) => normalizeNotificationPreferences({ userId: id })),
    upsertPreferences: vi.fn(async (preferences) => ({ ok: true, preferences: normalizeNotificationPreferences(preferences) })),
  }
}

describe('Phase 30A user account management foundation', () => {
  it('adds idempotent user profile migration without changing provider subject identity mapping', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_user_profiles')
    expect(sql).toContain('user_id TEXT PRIMARY KEY REFERENCES atlas_users(id)')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_user_profiles_preferred_workspace')
    expect(sql).toContain('UNIQUE (provider, provider_subject)')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
  })

  it('validates safe account profile fields and denies cross-user updates', async () => {
    const profile = normalizeUserProfile({ userId, displayName: 'Atlas Operator', timezone: 'America/New_York', locale: 'en-US', preferredWorkspace: 'workspace-1' })
    expect(validateUserProfile(profile)).toMatchObject({ valid: true })
    expect(() => assertOwnProfileUpdate({ actorUserId: userId, targetUserId: 'other-user' })).toThrow('profile update denied')

    const result = await updateUserAccount({ actorUserId: userId, profile }, {
      repository: profileRepository(),
      emitEvent: false,
    })
    expect(result.eventType).toBe(SYSTEM_USER_ACCOUNT_UPDATED_EVENT)
    expect(result.accountStatusSummary.passwordsStored).toBe(false)
    expect(result.accountStatusSummary.rawTokensStored).toBe(false)
  })

  it('uses parameterized profile repository queries and serves account APIs safely', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createUserProfileRepository({ database: { connected: true, query } })
    await repository.getProfile(userId)
    await repository.upsertProfile(normalizeUserProfile({ userId }))
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)

    const options = { repositoryFactory: () => createMockPersistenceRepository(), profileRepository: profileRepository(), env: { TRADING_MODE: 'paper' } }
    const current = parseResponse(await createCurrentAccountHandler(options)(authEvent('GET')))
    const update = parseResponse(await createAccountProfileUpdateHandler(options)(authEvent('POST', { profile: { displayName: 'Atlas Operator', timezone: 'America/New_York', locale: 'en-US', preferredWorkspace: 'workspace-1' } })))
    const denied = parseResponse(await createAccountProfileUpdateHandler(options)(authEvent('POST', { userId: 'other-user', profile: { displayName: 'Other', timezone: 'America/New_York', locale: 'en-US', preferredWorkspace: 'workspace-1' } })))
    const health = parseResponse(await createAccountHealthHandler(options)(authEvent('GET')))
    expect([current.statusCode, update.statusCode, health.statusCode]).toEqual([200, 200, 200])
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(current.json)).not.toContain('token_hash')
  })
})

describe('Phase 30B notification preference foundation', () => {
  it('adds idempotent notification preference migration and normalizes channels/categories', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_notification_preferences')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_notification_preferences_updated')
    const preferences = normalizeNotificationPreferences({ userId, categories: { security: { severityThreshold: 'high' } } })
    expect(Object.keys(preferences.categories)).toEqual(NOTIFICATION_CATEGORIES)
    expect(preferences.categories.security.channels.inApp).toBe(true)
    expect(preferences.externalProvidersConfigured).toBe(false)
  })

  it('updates only the current user preferences and keeps email/webhook placeholder-only', async () => {
    const result = await updateNotificationPreferences({
      actorUserId: userId,
      preferences: { userId, categories: { security: { severityThreshold: 'critical' } } },
    }, {
      repository: preferenceRepository(),
      emitEvent: false,
    })
    await expect(updateNotificationPreferences({
      actorUserId: userId,
      targetUserId: 'other-user',
      preferences: { userId: 'other-user' },
    }, {
      repository: preferenceRepository(),
      emitEvent: false,
    })).rejects.toThrow('notification preference update denied')
    expect(result.eventType).toBe(SYSTEM_NOTIFICATION_PREFERENCES_UPDATED_EVENT)
    expect(result.channelPlanning.externalProviderIntegration).toBe(false)
    expect(result.secretsStored).toBe(false)
  })

  it('uses parameterized preference repository queries and serves preference APIs safely', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createNotificationPreferenceRepository({ database: { connected: true, query } })
    await repository.getPreferences(userId)
    await repository.upsertPreferences(normalizeNotificationPreferences({ userId }))
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)

    const options = { repositoryFactory: () => createMockPersistenceRepository(), preferenceRepository: preferenceRepository(), env: { TRADING_MODE: 'paper' } }
    const current = parseResponse(await createNotificationPreferencesHandler(options)(authEvent('GET')))
    const update = parseResponse(await createNotificationPreferencesUpdateHandler(options)(authEvent('POST', { preferences: { categories: { security: { severityThreshold: 'high' } } } })))
    const denied = parseResponse(await createNotificationPreferencesUpdateHandler(options)(authEvent('POST', { userId: 'other-user', preferences: { userId: 'other-user' } })))
    expect([current.statusCode, update.statusCode]).toEqual([200, 200])
    expect(denied.statusCode).toBe(403)
    expect(current.json.data.externalProvidersConfigured).toBe(false)
    expect(update.json.data.secretsStored).toBe(false)
  })
})

describe('Phase 30C tenant administration UX operations', () => {
  it('summarizes tenant administration without destructive dashboard actions', () => {
    const result = evaluateTenantAdministrationOperations({
      tenantContext: { organizationId: 'org-1', teamWorkspaceId: 'team-1', userId, role: 'owner' },
      organization: { id: 'org-1', name: 'Atlas Org', status: 'healthy' },
      teamWorkspace: { id: 'team-1', name: 'Research Desk', status: 'healthy' },
      accessReview: { eventType: 'system.accessReview.evaluated', reviewStatus: 'healthy', organizationMembershipReview: { count: 1 }, teamMembershipReview: { count: 1 } },
      accessCertification: { eventType: 'system.accessCertification.evaluated', certificationStatus: 'complete', certificationDecision: 'approve' },
      collaborationGovernance: { eventType: 'system.collaborationGovernance.evaluated', invitationRiskSummary: { status: 'healthy', pendingCount: 1 } },
      sessionSecurity: { eventType: 'system.sessionSecurity.evaluated', securityStatus: 'healthy', activeSessionListing: [{}] },
      tenantOperationsHealth: { eventType: 'system.tenantOperations.evaluated', operationalStatus: 'healthy' },
      administrativeAudit: { eventType: 'system.administrativeAudit.recorded', status: 'recorded' },
      accountProfileSummary: { displayName: 'Atlas Operator' },
      notificationPreferenceSummary: { enabledCategories: 7 },
      rolePermissionSummary: { role: 'owner' },
      activeSessionSummary: { activeSessions: 1 },
      pendingInvitationSummary: { pendingCount: 1 },
    }, { emitEvent: false })
    expect(result.eventType).toBe(SYSTEM_TENANT_ADMINISTRATION_OPERATIONS_EVALUATED_EVENT)
    expect(result.operationalStatus).toBe('healthy')
    expect(result.destructiveDashboardActions).toBe(false)
    expect(result.liveOrders).toBe(false)
  })
})
