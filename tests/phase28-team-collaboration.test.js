import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  createTeamMembershipRepository,
  createTeamWorkspaceRepository,
  persistTeamWorkspace,
  updateTeamMembership,
} from '../lib/auth/teamWorkspaceRepository.js'
import {
  createInvitationRepository,
  hashInvitationToken,
  updateMembershipInvitation,
} from '../lib/auth/invitationRepository.js'
import {
  SYSTEM_TEAM_WORKSPACE_ACCESS_EVALUATED_EVENT,
  resolveTeamWorkspaceAccess,
} from '../lib/auth/teamWorkspaceAccess.js'
import {
  SYSTEM_WORKSPACE_COLLABORATION_OPERATIONS_EVALUATED_EVENT,
  evaluateWorkspaceCollaborationOperations,
} from '../lib/system/workspaceCollaborationOperationsEngine.js'
import { createCurrentTeamWorkspaceHandler } from '../netlify/functions/current-team-workspace.js'
import { createTeamWorkspaceMembershipsHandler } from '../netlify/functions/team-workspace-memberships.js'
import { createProtectedTeamWorkspaceConfigurationsHandler } from '../netlify/functions/protected-team-workspace-configurations.js'
import { createCollaborationHealthHandler } from '../netlify/functions/collaboration-health.js'
import { createOrganizationInvitationsHandler } from '../netlify/functions/organization-invitations.js'
import { createTeamWorkspaceInvitationsHandler } from '../netlify/functions/team-workspace-invitations.js'
import { createInvitationAcceptanceHandler } from '../netlify/functions/invitation-acceptance.js'
import { createInvitationRevocationHandler } from '../netlify/functions/invitation-revocation.js'

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, query = {}) {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-team',
      'x-atlas-dev-role': 'owner',
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
        list: vi.fn(async () => [{ id: 'workspace-1', payload: { teamWorkspaceId: 'team-1' } }]),
        upsert: vi.fn(async (id, payload) => ({ ok: true, data: { id, payload } })),
      })
    }
    return stores.get(name)
  }
  return { getStore, end: vi.fn(async () => {}) }
}

const orgMembership = { id: 'org-mem-1', organizationId: 'org-1', userId: 'local-development:local-operator', role: 'owner', status: 'active' }
const teamWorkspace = { id: 'team-1', organizationId: 'org-1', name: 'Research Desk', status: 'active' }
const teamMembership = { id: 'team-mem-1', organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'local-development:local-operator', role: 'owner', status: 'active' }

function routeOptions(overrides = {}) {
  return {
    repositoryFactory: () => createMockPersistenceRepository(),
    organizationMembershipRepository: { getMembership: vi.fn(async () => orgMembership) },
    teamWorkspaceRepository: { getWorkspace: vi.fn(async () => teamWorkspace) },
    teamMembershipRepository: {
      getMembership: vi.fn(async () => teamMembership),
      listMemberships: vi.fn(async () => [teamMembership]),
      createMembership: vi.fn(async (membership) => ({ ok: true, membership })),
      updateMembershipRole: vi.fn(async (teamWorkspaceId, userId, role) => ({ ok: true, membership: { ...teamMembership, role } })),
      revokeMembership: vi.fn(async () => ({ ok: true, membership: { ...teamMembership, status: 'revoked' } })),
    },
    invitationRepository: {
      listInvitations: vi.fn(async () => [{ id: 'invite-1', organizationId: 'org-1', teamWorkspaceId: 'team-1', role: 'analyst', status: 'pending' }]),
      createInvitation: vi.fn(async (invitation) => ({ ok: true, invitation: { ...invitation, id: 'invite-1', status: 'pending' }, tokenHash: hashInvitationToken('invite-token') })),
      acceptInvitation: vi.fn(async () => ({ ok: true, invitation: { id: 'invite-1', status: 'accepted' } })),
      revokeInvitation: vi.fn(async () => ({ ok: true, invitation: { id: 'invite-1', status: 'revoked' } })),
    },
    env: { TRADING_MODE: 'paper' },
    ...overrides,
  }
}

describe('Phase 28A team workspace persistence', () => {
  it('adds idempotent team workspace and team membership migrations', async () => {
    const sql = buildMigrationSql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_team_workspaces')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_team_workspace_memberships')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_team_memberships_active_user')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
  })

  it('uses parameterized team workspace and team membership queries', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'team-1', organization_id: 'org-1', name: 'Desk', status: 'active', metadata: {}, created_by_user_id: 'user-1' }] }))
    const database = { connected: true, query }
    await createTeamWorkspaceRepository({ database }).createWorkspace({ id: 'team-1', organizationId: 'org-1', name: 'Desk' })

    expect(query.mock.calls[0][0]).toContain('$1')
    expect(Array.isArray(query.mock.calls[0][1])).toBe(true)

    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 'team-mem-1', organization_id: 'org-1', team_workspace_id: 'team-1', user_id: 'user-1', role: 'analyst', status: 'active', metadata: {} }] })
    await createTeamMembershipRepository({ database }).createMembership({ id: 'team-mem-1', organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'user-1', role: 'analyst' })
    expect(query.mock.calls[2][0]).toContain('$1')
    expect(Array.isArray(query.mock.calls[2][1])).toBe(true)
  })

  it('prevents cross-organization and duplicate active team memberships', async () => {
    const crossOrg = await updateTeamMembership({ membership: teamMembership }, {
      repository: { createMembership: vi.fn(async () => ({ ok: false, error: { code: 'cross_organization_team_membership' }, membership: teamMembership })) },
      emitEvent: false,
    })
    const duplicate = await updateTeamMembership({ membership: teamMembership }, {
      repository: { createMembership: vi.fn(async () => ({ ok: false, error: { code: 'duplicate_active_team_membership' }, membership: teamMembership })) },
      emitEvent: false,
    })

    expect(crossOrg.boundaryProtection.crossOrganizationPrevented).toBe(true)
    expect(duplicate.boundaryProtection.duplicateActiveTeamMembershipPrevented).toBe(true)
  })

  it('emits team workspace lifecycle audit records', async () => {
    const result = await persistTeamWorkspace({ workspace: teamWorkspace }, {
      repository: { createWorkspace: vi.fn(async (workspace) => ({ ok: true, workspace })) },
      emitEvent: false,
    })

    expect(result.eventType).toBe('system.teamWorkspace.persisted')
    expect(result.auditRecord.category).toBe('team_workspace_lifecycle')
    expect(result.liveOrders).toBe(false)
  })
})

describe('Phase 28B invitation and membership onboarding foundation', () => {
  it('adds idempotent invitation migration and stores token hashes only', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_membership_invitations')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_invitations_token_hash')

    const result = await updateMembershipInvitation({
      inviterRole: 'admin',
      invitation: { id: 'invite-1', organizationId: 'org-1', teamWorkspaceId: 'team-1', role: 'analyst', token: 'raw-token' },
    }, {
      repository: {
        createInvitation: vi.fn(async (invitation) => ({ ok: true, invitation: { ...invitation, status: 'pending' }, tokenHash: hashInvitationToken('raw-token') })),
      },
      emitEvent: false,
    })

    expect(result.tokenHashStored).toBe(true)
    expect(result.rawTokenReturned).toBe(false)
    expect(JSON.stringify(result)).not.toContain('raw-token')
  })

  it('rejects privilege escalation, expired, and revoked invitations safely', async () => {
    const escalation = await updateMembershipInvitation({
      inviterRole: 'viewer',
      invitation: { id: 'invite-1', organizationId: 'org-1', role: 'admin', token: 'token' },
    }, {
      repository: createInvitationRepository({ database: { connected: false } }),
      emitEvent: false,
    })
    const expired = await updateMembershipInvitation({ action: 'accept', token: 'expired-token', acceptedByUserId: 'user-1' }, {
      repository: { acceptInvitation: vi.fn(async () => ({ ok: false, error: { code: 'invitation_expired' }, invitation: { id: 'invite-2', status: 'expired' } })) },
      emitEvent: false,
    })
    const revoked = await updateMembershipInvitation({ action: 'accept', token: 'revoked-token', acceptedByUserId: 'user-1' }, {
      repository: { acceptInvitation: vi.fn(async () => ({ ok: false, error: { code: 'invitation_revoked' }, invitation: { id: 'invite-3', status: 'revoked' } })) },
      emitEvent: false,
    })

    expect(escalation.status).toBe('blocked')
    expect(expired.error.code).toBe('invitation_expired')
    expect(revoked.error.code).toBe('invitation_revoked')
  })

  it('serves invitation APIs with safe public failures for expired invites', async () => {
    const options = routeOptions({
      invitationRepository: {
        ...routeOptions().invitationRepository,
        acceptInvitation: vi.fn(async () => ({ ok: false, error: { code: 'invitation_expired' }, invitation: { id: 'invite-1', status: 'expired' } })),
      },
    })
    const orgInvites = parseResponse(await createOrganizationInvitationsHandler(options)(authEvent('GET', {}, { organizationId: 'org-1' })))
    const teamInvites = parseResponse(await createTeamWorkspaceInvitationsHandler(options)(authEvent('GET', {}, { organizationId: 'org-1', teamWorkspaceId: 'team-1' })))
    const acceptance = parseResponse(await createInvitationAcceptanceHandler(options)(authEvent('POST', { token: 'expired-token' })))
    const revocation = parseResponse(await createInvitationRevocationHandler(options)(authEvent('POST', { organizationId: 'org-1', invitationId: 'invite-1' })))

    expect(orgInvites.statusCode).toBe(200)
    expect(teamInvites.statusCode).toBe(200)
    expect(acceptance.statusCode).toBe(400)
    expect(acceptance.json.error.message).toBe('invitation cannot be accepted')
    expect(revocation.statusCode).toBe(200)
  })
})

describe('Phase 28C collaboration access and operations', () => {
  it('resolves team access and denies cross-organization and cross-team access', () => {
    const granted = resolveTeamWorkspaceAccess({ user: { id: 'user-1' }, organizationMembership: { ...orgMembership, userId: 'user-1' }, teamMembership: { ...teamMembership, userId: 'user-1', role: 'analyst' }, teamWorkspace, action: 'read' }, { emitEvent: false })
    const crossOrg = resolveTeamWorkspaceAccess({ user: { id: 'user-1' }, organizationMembership: { ...orgMembership, userId: 'user-1' }, teamMembership: { ...teamMembership, userId: 'user-1', organizationId: 'org-2' }, teamWorkspace, action: 'read' }, { emitEvent: false })
    const crossTeam = resolveTeamWorkspaceAccess({ user: { id: 'user-1' }, organizationMembership: { ...orgMembership, userId: 'user-1' }, teamMembership: { ...teamMembership, userId: 'user-1', teamWorkspaceId: 'team-2' }, teamWorkspace, action: 'read' }, { emitEvent: false })

    expect(granted.eventType).toBe(SYSTEM_TEAM_WORKSPACE_ACCESS_EVALUATED_EVENT)
    expect(granted.accessStatus).toBe('approved')
    expect(crossOrg.crossOrganizationAccessDenied).toBe(true)
    expect(crossTeam.crossTeamAccessDenied).toBe(true)
  })

  it('serves protected team workspace APIs and denies missing/cross-team context', async () => {
    const options = routeOptions()
    const current = parseResponse(await createCurrentTeamWorkspaceHandler(options)(authEvent('GET', {}, { organizationId: 'org-1', teamWorkspaceId: 'team-1' })))
    const memberships = parseResponse(await createTeamWorkspaceMembershipsHandler(options)(authEvent('GET', {}, { organizationId: 'org-1', teamWorkspaceId: 'team-1' })))
    const configs = parseResponse(await createProtectedTeamWorkspaceConfigurationsHandler(options)(authEvent('GET', {}, { organizationId: 'org-1', teamWorkspaceId: 'team-1' })))
    const health = parseResponse(await createCollaborationHealthHandler(options)(authEvent('GET', {}, { organizationId: 'org-1', teamWorkspaceId: 'team-1' })))
    const missing = parseResponse(await createCurrentTeamWorkspaceHandler(options)(authEvent('GET', {}, { organizationId: 'org-1' })))
    const crossTeam = parseResponse(await createCurrentTeamWorkspaceHandler(options)(authEvent('GET', {}, { organizationId: 'org-1', teamWorkspaceId: 'team-1', requestedTeamWorkspaceId: 'team-2' })))

    expect([current.statusCode, memberships.statusCode, configs.statusCode, health.statusCode]).toEqual([200, 200, 200, 200])
    expect(missing.statusCode).toBe(403)
    expect(crossTeam.statusCode).toBe(403)
    expect(crossTeam.json.error.message).toBe('team workspace access denied')
  })

  it('summarizes workspace collaboration operations', () => {
    const teamAccess = resolveTeamWorkspaceAccess({ user: { id: 'user-1' }, organizationMembership: { ...orgMembership, userId: 'user-1' }, teamMembership: { ...teamMembership, userId: 'user-1' }, teamWorkspace }, { emitEvent: false })
    const result = evaluateWorkspaceCollaborationOperations({
      teamWorkspaceAccess: teamAccess,
      activeCollaborators: [teamMembership],
      pendingInvitations: [{ id: 'invite-1', status: 'pending' }],
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_WORKSPACE_COLLABORATION_OPERATIONS_EVALUATED_EVENT)
    expect(result.operationalStatus).toBe('healthy')
    expect(result.activeCollaboratorsSummary.count).toBe(1)
    expect(result.pendingInvitationsSummary.count).toBe(1)
  })
})
