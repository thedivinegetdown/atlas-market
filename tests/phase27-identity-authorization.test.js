import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../lib/core/eventBus.js'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  SYSTEM_AUTHENTICATION_INITIALIZED_EVENT,
  createLocalDevelopmentAuthAdapter,
  hashSessionToken,
  initializeAuthentication,
  normalizeAuthenticationError,
  validateAuthenticatedSession,
} from '../lib/auth/authenticationProvider.js'
import {
  SYSTEM_USER_IDENTITY_PERSISTED_EVENT,
  SYSTEM_USER_SESSION_UPDATED_EVENT,
  createUserIdentityRepository,
  createUserSessionRepository,
  persistUserIdentity,
  updateUserSession,
} from '../lib/auth/identityRepository.js'
import {
  SYSTEM_AUTHORIZATION_EVALUATED_EVENT,
  createAuthorizationService,
  evaluateAuthorization,
} from '../lib/auth/authorizationService.js'
import { createSessionStatusHandler } from '../netlify/functions/session-status.js'
import { createCurrentUserHandler } from '../netlify/functions/current-user.js'
import { createSessionRevokeHandler } from '../netlify/functions/session-revoke.js'
import { createProtectedWorkspaceConfigurationsHandler } from '../netlify/functions/protected-workspace-configurations.js'
import { createAuthorizationHealthHandler } from '../netlify/functions/authorization-health.js'

function parseResponse(response) {
  return {
    ...response,
    json: response.body ? JSON.parse(response.body) : null,
  }
}

function authEvent(method = 'GET', headers = {}) {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-auth',
      ...headers,
    },
    body: method === 'POST' ? JSON.stringify({ id: 'workspace-1', payload: { density: 'operator' } }) : '',
  }
}

function createMockPersistenceRepository() {
  const stores = new Map()
  const getStore = (name) => {
    if (!stores.has(name)) {
      stores.set(name, {
        list: vi.fn(async () => [{ id: 'workspace-1', payload: { density: 'operator' } }]),
        upsert: vi.fn(async (id, payload) => ({ ok: true, data: { id, payload } })),
      })
    }
    return stores.get(name)
  }
  return {
    getStore,
    end: vi.fn(async () => {}),
  }
}

describe('Phase 27A authentication provider abstraction', () => {
  it('initializes a swappable non-production local development auth adapter', async () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_AUTHENTICATION_INITIALIZED_EVENT, (payload) => events.push(payload))

    const result = await initializeAuthentication({}, { eventBus })

    expect(result.eventType).toBe(SYSTEM_AUTHENTICATION_INITIALIZED_EVENT)
    expect(result.authenticationStatus).toBe('ready')
    expect(result.providerInterface.swappable).toBe(true)
    expect(result.localDevelopmentAuthenticationAdapter.nonProductionOnly).toBe(true)
    expect(result.hardCodedCredentials).toBe(false)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(events[0]).toBe(result)
  })

  it('authenticates local development sessions and rejects expired sessions', async () => {
    const provider = createLocalDevelopmentAuthAdapter({
      now: () => new Date('2026-07-10T12:00:00.000Z'),
      sessionTtlMs: 1000,
    })
    const authenticated = await provider.authenticate({
      headers: { authorization: 'Bearer local-token', 'x-atlas-dev-role': 'analyst' },
    })

    expect(authenticated.user.role).toBe('analyst')
    expect(authenticated.session.tokenHash).toBe(hashSessionToken('local-token'))
    expect(validateAuthenticatedSession(authenticated.session, new Date('2026-07-10T12:00:00.500Z')).valid).toBe(true)
    expect(validateAuthenticatedSession(authenticated.session, new Date('2026-07-10T12:00:02.000Z')).status).toBe('expired')
    expect(normalizeAuthenticationError(new Error('secret provider detail')).error.message).toBe('authentication failed')
  })
})

describe('Phase 27B user identity and session persistence', () => {
  it('adds idempotent user and session migrations', async () => {
    const sql = buildMigrationSql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_users')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_user_sessions')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_user_sessions_token_hash')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({
      ok: true,
      disabled: true,
    })
  })

  it('uses parameterized queries for identity and session repositories', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'user-1', provider: 'local-development', provider_subject: 'subject-1', display_name: 'Operator', role: 'owner', metadata: {} }] }))
    const database = { connected: true, query }
    const userRepository = createUserIdentityRepository({ database })

    await userRepository.upsertUser({ id: 'user-1', providerSubject: 'subject-1', role: 'owner' })

    expect(query.mock.calls[0][0]).toContain('$1')
    expect(Array.isArray(query.mock.calls[0][1])).toBe(true)

    query.mockResolvedValueOnce({ rows: [{ id: 'session-1', user_id: 'user-1', provider: 'local-development', token_hash: 'hash', status: 'active', metadata: {}, expires_at: '2026-07-10T13:00:00.000Z' }] })
    const sessionRepository = createUserSessionRepository({ database })
    await sessionRepository.createSession({
      user: { id: 'user-1', providerSubject: 'subject-1', role: 'owner' },
      session: { id: 'session-1', token: 'local-token', expiresAt: '2026-07-10T13:00:00.000Z' },
    })

    expect(query.mock.calls[1][0]).toContain('$1')
    expect(Array.isArray(query.mock.calls[1][1])).toBe(true)
  })

  it('emits identity and session lifecycle audit events without raw tokens', async () => {
    const identityEvents = []
    const sessionEvents = []
    const eventBus = createEventBus()
    eventBus.subscribe(SYSTEM_USER_IDENTITY_PERSISTED_EVENT, (payload) => identityEvents.push(payload))
    eventBus.subscribe(SYSTEM_USER_SESSION_UPDATED_EVENT, (payload) => sessionEvents.push(payload))
    const userRepository = {
      upsertUser: vi.fn(async (identity) => ({ ok: true, user: { ...identity, id: 'user-1', role: 'owner' } })),
    }
    const sessionRepository = {
      createSession: vi.fn(async ({ session }) => ({ ok: true, session: { ...session, id: 'session-1', userId: 'user-1' } })),
    }

    const identity = await persistUserIdentity({ identity: { providerSubject: 'subject-1', role: 'owner' } }, { eventBus, repository: userRepository })
    const session = await updateUserSession({
      user: identity.userIdentity,
      session: { token: 'local-token', expiresAt: '2026-07-10T13:00:00.000Z' },
    }, { eventBus, repository: sessionRepository })

    expect(identity.plaintextPasswordsStored).toBe(false)
    expect(session.rawAccessTokensStored).toBe(false)
    expect(JSON.stringify(session)).not.toContain('local-token')
    expect(identityEvents[0]).toBe(identity)
    expect(sessionEvents[0]).toBe(session)
  })
})

describe('Phase 27C authorization enforcement foundation and routes', () => {
  it('evaluates permissions from owner/admin/analyst/viewer roles and defaults deny without role context', () => {
    expect(evaluateAuthorization({ user: { role: 'owner', metadata: { ownedWorkspaceIds: ['workspace-1'] } }, permission: 'workspace.owner', workspaceId: 'workspace-1' }, { emitEvent: false }).allowed).toBe(true)
    expect(evaluateAuthorization({ user: { role: 'admin' }, permission: 'workspace.owner', workspaceId: 'workspace-1' }, { emitEvent: false }).allowed).toBe(false)
    expect(evaluateAuthorization({ user: { role: 'analyst' }, permission: 'paperTrading.read' }, { emitEvent: false }).allowed).toBe(true)
    expect(evaluateAuthorization({ user: { role: 'viewer' }, permission: 'workspace.admin' }, { emitEvent: false }).authorizationStatus).toBe('rejected')
    expect(evaluateAuthorization({ permission: 'dashboard.read' }, { emitEvent: false }).restrictedActionHandling.defaultDeny).toBe(true)
  })

  it('emits authorization decisions and throws safe forbidden errors', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_AUTHORIZATION_EVALUATED_EVENT, (payload) => events.push(payload))
    const service = createAuthorizationService({ eventBus })

    expect(service.evaluate({ user: { id: 'viewer-1', role: 'viewer' }, permission: 'dashboard.read' }).allowed).toBe(true)
    expect(() => service.assert({ user: { id: 'viewer-1', role: 'viewer' }, permission: 'workspace.admin' })).toThrow('permission denied')
    expect(events[0].eventType).toBe(SYSTEM_AUTHORIZATION_EVALUATED_EVENT)
  })

  it('fails unauthenticated and unauthorized API requests safely', async () => {
    const repositoryFactory = () => createMockPersistenceRepository()
    const protectedHandler = createProtectedWorkspaceConfigurationsHandler({
      repositoryFactory,
      env: { TRADING_MODE: 'paper' },
    })

    const unauthenticated = parseResponse(await protectedHandler({ httpMethod: 'GET', headers: {} }))
    const unauthorized = parseResponse(await protectedHandler(authEvent('GET', { 'x-atlas-dev-role': 'viewer' })))

    expect(unauthenticated.statusCode).toBe(401)
    expect(unauthenticated.json.error.message).toBe('authentication required')
    expect(unauthorized.statusCode).toBe(403)
    expect(unauthorized.json.error.message).toBe('forbidden')
  })

  it('serves authenticated session, current user, revoke, protected workspace, and authorization health routes', async () => {
    const repositoryFactory = () => createMockPersistenceRepository()
    const sessionRepository = {
      revokeSession: vi.fn(async (sessionId) => ({ ok: true, session: { id: sessionId, status: 'revoked' } })),
    }
    const routeOptions = {
      repositoryFactory,
      env: { TRADING_MODE: 'paper' },
    }
    const responses = [
      parseResponse(await createSessionStatusHandler(routeOptions)(authEvent())),
      parseResponse(await createCurrentUserHandler(routeOptions)(authEvent())),
      parseResponse(await createProtectedWorkspaceConfigurationsHandler(routeOptions)(authEvent('GET'))),
      parseResponse(await createSessionRevokeHandler({ ...routeOptions, sessionRepository })(authEvent('POST'))),
      parseResponse(await createAuthorizationHealthHandler(routeOptions)(authEvent())),
    ]

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200])
    expect(responses[0].json.data.event.endpoint).toBe('session-status')
    expect(responses[1].json.data.user.role).toBe('owner')
    expect(responses[2].json.data.workspaceConfigurations[0].id).toBe('workspace-1')
    expect(responses[3].json.data.revocationStatus).toBe('ready')
    expect(responses[4].json.data.authorizationStatus).toBe('approved')
    expect(responses.every((response) => response.json.data.liveOrders === false)).toBe(true)
  })
})
