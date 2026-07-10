import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createUserSessionRepository } from '../lib/auth/identityRepository.js'
import {
  SYSTEM_ORGANIZATION_ADMINISTRATION_UPDATED_EVENT,
  SYSTEM_TEAM_WORKSPACE_ADMINISTRATION_UPDATED_EVENT,
  updateOrganizationAdministration,
  updateTeamWorkspaceAdministration,
  validateOwnershipTransfer,
} from '../lib/auth/administrationService.js'
import {
  SYSTEM_SESSION_SECURITY_EVALUATED_EVENT,
  evaluateSessionSecurity,
  revokeSessionSecurity,
} from '../lib/auth/sessionSecurityService.js'
import {
  SYSTEM_COLLABORATION_GOVERNANCE_EVALUATED_EVENT,
  evaluateCollaborationGovernance,
} from '../lib/system/collaborationGovernanceEngine.js'
import { createOrganizationAdministrationHandler } from '../netlify/functions/organization-administration.js'
import { createTeamWorkspaceAdministrationHandler } from '../netlify/functions/team-workspace-administration.js'
import { createMembershipRoleManagementHandler } from '../netlify/functions/membership-role-management.js'
import { createMembershipStatusManagementHandler } from '../netlify/functions/membership-status-management.js'
import { createActiveSessionsHandler } from '../netlify/functions/active-sessions.js'
import { createRevokeSelectedSessionHandler } from '../netlify/functions/revoke-selected-session.js'
import { createRevokeOtherSessionsHandler } from '../netlify/functions/revoke-other-sessions.js'
import { createSessionSecurityHealthHandler } from '../netlify/functions/session-security-health.js'

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, query = {}, role = 'owner') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase28-def',
      'x-atlas-dev-role': role,
    },
    queryStringParameters: query,
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function createMockPersistenceRepository() {
  const stores = new Map()
  const getStore = (name) => {
    if (!stores.has(name)) {
      stores.set(name, {
        list: vi.fn(async () => []),
        upsert: vi.fn(async (id, payload) => ({ ok: true, data: { id, payload } })),
      })
    }
    return stores.get(name)
  }
  return { getStore, end: vi.fn(async () => {}) }
}

const organizationMembership = {
  id: 'membership-org-1-owner',
  organizationId: 'org-1',
  userId: 'local-development:local-operator',
  role: 'owner',
  status: 'active',
}

const teamWorkspace = {
  id: 'team-1',
  organizationId: 'org-1',
  name: 'Research Desk',
  status: 'active',
}

const teamMembership = {
  id: 'team-membership-1',
  organizationId: 'org-1',
  teamWorkspaceId: 'team-1',
  userId: 'local-development:local-operator',
  role: 'owner',
  status: 'active',
}

function routeOptions(overrides = {}) {
  return {
    repositoryFactory: () => createMockPersistenceRepository(),
    organizationMembershipRepository: {
      getMembership: vi.fn(async () => organizationMembership),
      updateMembershipRole: vi.fn(async (organizationId, userId, role) => ({ ok: true, membership: { ...organizationMembership, organizationId, userId, role } })),
      revokeMembership: vi.fn(async (organizationId, userId) => ({ ok: true, membership: { ...organizationMembership, organizationId, userId, status: 'revoked' } })),
      createMembership: vi.fn(async (membership) => ({ ok: true, membership })),
    },
    organizationRepository: {
      createOrganization: vi.fn(async (organization) => ({ ok: true, organization })),
    },
    teamWorkspaceRepository: {
      getWorkspace: vi.fn(async () => teamWorkspace),
      updateWorkspace: vi.fn(async (teamWorkspaceId, updates) => ({ ok: true, workspace: { ...teamWorkspace, id: teamWorkspaceId, ...updates } })),
      archiveWorkspace: vi.fn(async () => ({ ok: true, workspace: { ...teamWorkspace, status: 'archived' } })),
      createWorkspace: vi.fn(async (workspace) => ({ ok: true, workspace })),
    },
    teamMembershipRepository: {
      getMembership: vi.fn(async () => teamMembership),
      updateMembershipRole: vi.fn(async (teamWorkspaceId, userId, role) => ({ ok: true, membership: { ...teamMembership, teamWorkspaceId, userId, role } })),
      revokeMembership: vi.fn(async (teamWorkspaceId, userId) => ({ ok: true, membership: { ...teamMembership, teamWorkspaceId, userId, status: 'revoked' } })),
      createMembership: vi.fn(async (membership) => ({ ok: true, membership })),
    },
    sessionRepository: {
      listActiveSessions: vi.fn(async () => [
        {
          id: 'session-1',
          userId: 'local-development:local-operator',
          status: 'active',
          tokenHash: 'should-not-return',
          token: 'raw-token',
          deviceFingerprint: 'device-1',
          lastSeenAt: '2026-07-10T12:00:00.000Z',
          expiresAt: '2026-07-10T13:00:00.000Z',
        },
      ]),
      revokeSession: vi.fn(async (sessionId) => ({ ok: true, session: { id: sessionId, status: 'revoked', tokenHash: 'should-not-return' } })),
      revokeOtherSessions: vi.fn(async () => ({ ok: true, revokedCount: 1, sessions: [{ id: 'session-2', status: 'revoked' }] })),
    },
    env: { TRADING_MODE: 'paper' },
    ...overrides,
  }
}

describe('Phase 28D organization and team administration service', () => {
  it('validates owner-only ownership transfer and protects the final owner', async () => {
    expect(validateOwnershipTransfer({ actorRole: 'admin', targetRole: 'owner', activeOwnerCount: 2 })).toMatchObject({ valid: false })
    expect(validateOwnershipTransfer({ actorRole: 'owner', targetRole: 'owner', activeOwnerCount: 2 })).toMatchObject({ valid: true })

    const demotion = await updateOrganizationAdministration({
      action: 'membership-role-update',
      organizationId: 'org-1',
      actorMembership: organizationMembership,
      currentMembership: { role: 'owner' },
      userId: 'local-development:local-operator',
      role: 'admin',
      activeOwnerCount: 1,
    }, { emitEvent: false })

    expect(demotion.administrationStatus).toBe('blocked')
    expect(demotion.finalOwnerProtection).toBe(true)
    expect(demotion.auditRecord.category).toBe('administration')
  })

  it('denies cross-organization administration and emits administration events', async () => {
    const result = await updateOrganizationAdministration({
      action: 'profile-update',
      organizationId: 'org-1',
      requestedOrganizationId: 'org-2',
      actorMembership: organizationMembership,
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_ORGANIZATION_ADMINISTRATION_UPDATED_EVENT)
    expect(result.crossOrganizationAdministrationDenied).toBe(true)
    expect(result.liveOrders).toBe(false)
  })

  it('updates team workspace administration without duplicating role logic in handlers', async () => {
    const result = await updateTeamWorkspaceAdministration({
      action: 'team-archive',
      actorMembership: organizationMembership,
      teamWorkspace,
      teamMembership,
    }, {
      teamWorkspaceRepository: routeOptions().teamWorkspaceRepository,
      emitEvent: false,
    })

    expect(result.eventType).toBe(SYSTEM_TEAM_WORKSPACE_ADMINISTRATION_UPDATED_EVENT)
    expect(result.administrationStatus).toBe('ready')
    expect(result.result.workspace.status).toBe('archived')
  })

  it('serves administration and membership management APIs', async () => {
    const options = routeOptions()
    const organizationAdmin = parseResponse(await createOrganizationAdministrationHandler(options)(authEvent('POST', { organizationId: 'org-1', name: 'Atlas Org' })))
    const teamAdmin = parseResponse(await createTeamWorkspaceAdministrationHandler(options)(authEvent('POST', { organizationId: 'org-1', teamWorkspaceId: 'team-1', action: 'team-profile-update', name: 'Desk' })))
    const role = parseResponse(await createMembershipRoleManagementHandler(options)(authEvent('POST', { organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'user-2', role: 'analyst' })))
    const status = parseResponse(await createMembershipStatusManagementHandler(options)(authEvent('POST', { organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'user-2', status: 'suspended' })))

    expect([organizationAdmin.statusCode, teamAdmin.statusCode, role.statusCode, status.statusCode]).toEqual([200, 200, 200, 200])
    expect(organizationAdmin.json.data.result.eventType).toBe(SYSTEM_ORGANIZATION_ADMINISTRATION_UPDATED_EVENT)
    expect(teamAdmin.json.data.result.eventType).toBe(SYSTEM_TEAM_WORKSPACE_ADMINISTRATION_UPDATED_EVENT)
  })
})

describe('Phase 28E session security and device management', () => {
  it('adds idempotent session metadata migration and repository parameterized session operations', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS device_fingerprint')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_user_sessions_user_status')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    const query = vi.fn(async () => ({ rows: [{ id: 'session-1', user_id: 'user-1', provider: 'local-development', status: 'active', metadata: {}, expires_at: '2026-07-10T13:00:00.000Z' }] }))
    const repository = createUserSessionRepository({ database: { connected: true, query } })
    await repository.listActiveSessions('user-1')
    await repository.revokeOtherSessions('user-1', 'session-1')

    expect(query.mock.calls[0][0]).toContain('$1')
    expect(Array.isArray(query.mock.calls[0][1])).toBe(true)
    expect(query.mock.calls[1][0]).toContain('$4')
    expect(Array.isArray(query.mock.calls[1][1])).toBe(true)
  })

  it('evaluates session security without exposing raw tokens or token hashes', () => {
    const result = evaluateSessionSecurity({
      user: { id: 'user-1' },
      sessions: [
        { id: 'session-1', status: 'active', token: 'raw-token', tokenHash: 'hash', lastSeenAt: '2026-07-10T11:00:00.000Z', expiresAt: '2026-07-10T13:00:00.000Z' },
      ],
    }, {
      emitEvent: false,
      now: () => new Date('2026-07-10T12:00:00.000Z'),
    })

    expect(result.eventType).toBe(SYSTEM_SESSION_SECURITY_EVALUATED_EVENT)
    expect(result.securityStatus).toBe('caution')
    expect(result.deviceSessionMetadataModel.rawTokensExposed).toBe(false)
    expect(JSON.stringify(result)).not.toContain('raw-token')
    expect(JSON.stringify(result)).not.toContain('hash')
  })

  it('revokes own sessions and denies unauthorized third-party revocation safely', async () => {
    const own = await revokeSessionSecurity({
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      sessionId: 'session-1',
    }, {
      repository: routeOptions().sessionRepository,
    })
    const forbidden = await revokeSessionSecurity({
      actorUserId: 'user-1',
      actorRole: 'viewer',
      targetUserId: 'user-2',
      sessionId: 'session-2',
    }, {
      repository: routeOptions().sessionRepository,
    })

    expect(own.ok).toBe(true)
    expect(JSON.stringify(own)).not.toContain('should-not-return')
    expect(forbidden.ok).toBe(false)
    expect(forbidden.statusCode).toBe(403)
  })

  it('serves session security APIs and hides tokens and hashes in public responses', async () => {
    const options = routeOptions()
    const active = parseResponse(await createActiveSessionsHandler(options)(authEvent('GET')))
    const selected = parseResponse(await createRevokeSelectedSessionHandler(options)(authEvent('POST', { sessionId: 'session-1' })))
    const others = parseResponse(await createRevokeOtherSessionsHandler(options)(authEvent('POST')))
    const health = parseResponse(await createSessionSecurityHealthHandler(options)(authEvent('GET')))
    const denied = parseResponse(await createRevokeSelectedSessionHandler(options)(authEvent('POST', { sessionId: 'session-2', targetUserId: 'user-2' }, {}, 'viewer')))

    expect([active.statusCode, selected.statusCode, others.statusCode, health.statusCode]).toEqual([200, 200, 200, 200])
    expect(denied.statusCode).toBe(403)
    expect(JSON.stringify(active.json)).not.toContain('raw-token')
    expect(JSON.stringify(active.json)).not.toContain('should-not-return')
    expect(health.json.data.sessionSecurity.deviceSessionMetadataModel.tokenHashesExposed).toBe(false)
  })
})

describe('Phase 28F collaboration governance and access review', () => {
  it('summarizes memberships, invitations, orphaned workspaces, elevated roles, and boundary denials', () => {
    const result = evaluateCollaborationGovernance({
      organizationMemberships: [
        { id: 'org-owner', organizationId: 'org-1', userId: 'owner', role: 'owner', status: 'active' },
        { id: 'org-admin', organizationId: 'org-1', userId: 'admin', role: 'admin', status: 'suspended' },
      ],
      teamMemberships: [
        { id: 'team-viewer', organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'viewer', role: 'viewer', status: 'active' },
      ],
      invitations: [
        { id: 'invite-1', organizationId: 'org-1', role: 'analyst', status: 'expired' },
      ],
      teamWorkspaces: [
        { id: 'team-1', organizationId: 'org-1', status: 'active' },
        { id: 'team-orphaned', organizationId: 'org-1', status: 'active' },
      ],
      crossBoundaryDenials: [{ id: 'denial-1' }],
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_COLLABORATION_GOVERNANCE_EVALUATED_EVENT)
    expect(result.governanceStatus).toBe('blocked')
    expect(result.automaticRoleChanges).toBe(false)
    expect(result.automaticMembershipRevocation).toBe(false)
    expect(result.orphanedWorkspaceDetection.orphanedWorkspaceIds).toContain('team-orphaned')
  })
})
