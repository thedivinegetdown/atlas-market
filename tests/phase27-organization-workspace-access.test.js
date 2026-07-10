import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../lib/core/eventBus.js'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  SYSTEM_ORGANIZATION_MEMBERSHIP_UPDATED_EVENT,
  SYSTEM_ORGANIZATION_PERSISTED_EVENT,
  createOrganizationMembershipRepository,
  createOrganizationRepository,
  persistOrganization,
  updateOrganizationMembership,
} from '../lib/auth/organizationRepository.js'
import {
  SYSTEM_ORGANIZATION_WORKSPACE_ACCESS_EVALUATED_EVENT,
  resolveWorkspaceAccess,
} from '../lib/auth/organizationWorkspaceAccess.js'
import {
  SYSTEM_IDENTITY_ORGANIZATION_OPERATIONS_EVALUATED_EVENT,
  evaluateIdentityOrganizationOperations,
} from '../lib/system/identityOrganizationOperationsEngine.js'
import { createCurrentOrganizationHandler } from '../netlify/functions/current-organization.js'
import { createOrganizationMembershipsHandler } from '../netlify/functions/organization-memberships.js'
import { createProtectedOrganizationWorkspaceConfigurationsHandler } from '../netlify/functions/protected-organization-workspace-configurations.js'
import { createOrganizationAuthorizationHealthHandler } from '../netlify/functions/organization-authorization-health.js'

function parseResponse(response) {
  return {
    ...response,
    json: response.body ? JSON.parse(response.body) : null,
  }
}

function authEvent(method = 'GET', body = {}, query = {}) {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-org',
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
        list: vi.fn(async () => [{ id: 'workspace-1', payload: { organizationId: 'org-1' } }]),
        upsert: vi.fn(async (id, payload) => ({ ok: true, data: { id, payload } })),
      })
    }
    return stores.get(name)
  }
  return { getStore, end: vi.fn(async () => {}) }
}

function createMockMembershipRepository(membership = { id: 'mem-1', organizationId: 'org-1', userId: 'local-development:local-operator', role: 'owner', status: 'active' }) {
  return {
    getMembership: vi.fn(async (organizationId, userId) => (organizationId === membership.organizationId && userId === membership.userId ? membership : null)),
    listMemberships: vi.fn(async () => [membership]),
    createMembership: vi.fn(async (nextMembership) => ({ ok: true, membership: nextMembership })),
    updateMembershipRole: vi.fn(async (organizationId, userId, role) => ({ ok: true, membership: { ...membership, role } })),
    revokeMembership: vi.fn(async () => ({ ok: true, membership: { ...membership, status: 'revoked' } })),
  }
}

describe('Phase 27D organization and membership persistence', () => {
  it('adds idempotent organization and membership migrations', async () => {
    const sql = buildMigrationSql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_organizations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_organization_memberships')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_org_memberships_active_user')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
  })

  it('uses parameterized queries for organization and membership writes', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 'org-1', name: 'Atlas Org', status: 'active', metadata: {}, created_by_user_id: 'user-1' }],
    }))
    const database = { connected: true, query }
    const organizationRepository = createOrganizationRepository({ database })

    await organizationRepository.createOrganization({ id: 'org-1', name: 'Atlas Org', createdByUserId: 'user-1' })

    expect(query.mock.calls[0][0]).toContain('$1')
    expect(Array.isArray(query.mock.calls[0][1])).toBe(true)

    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 'mem-1', organization_id: 'org-1', user_id: 'user-1', role: 'owner', status: 'active', metadata: {} }] })
    const membershipRepository = createOrganizationMembershipRepository({ database })
    await membershipRepository.createMembership({ id: 'mem-1', organizationId: 'org-1', userId: 'user-1', role: 'owner' })

    expect(query.mock.calls[2][0]).toContain('$1')
    expect(Array.isArray(query.mock.calls[2][1])).toBe(true)
  })

  it('prevents duplicate active memberships and removing the final owner', async () => {
    const duplicateRepository = {
      createMembership: vi.fn(async () => ({ ok: false, error: { code: 'duplicate_active_membership' }, membership: { id: 'mem-1', role: 'owner' } })),
    }
    const finalOwnerRepository = {
      revokeMembership: vi.fn(async () => ({ ok: false, error: { code: 'final_owner_protected' }, membership: { id: 'mem-1', role: 'owner' } })),
    }

    const duplicate = await updateOrganizationMembership({ membership: { id: 'mem-1', organizationId: 'org-1', userId: 'user-1', role: 'owner' } }, { repository: duplicateRepository, emitEvent: false })
    const finalOwner = await updateOrganizationMembership({ action: 'revoke', organizationId: 'org-1', userId: 'user-1' }, { repository: finalOwnerRepository, emitEvent: false })

    expect(duplicate.status).toBe('blocked')
    expect(duplicate.ownershipProtection.duplicateActiveMembershipPrevented).toBe(true)
    expect(finalOwner.status).toBe('blocked')
    expect(finalOwner.ownershipProtection.finalOwnerProtected).toBe(true)
  })

  it('emits organization lifecycle audit events', async () => {
    const eventBus = createEventBus()
    const organizationEvents = []
    const membershipEvents = []
    eventBus.subscribe(SYSTEM_ORGANIZATION_PERSISTED_EVENT, (payload) => organizationEvents.push(payload))
    eventBus.subscribe(SYSTEM_ORGANIZATION_MEMBERSHIP_UPDATED_EVENT, (payload) => membershipEvents.push(payload))

    const organization = await persistOrganization({ organization: { id: 'org-1', name: 'Atlas Org', createdByUserId: 'user-1' } }, {
      eventBus,
      repository: { createOrganization: vi.fn(async (input) => ({ ok: true, organization: { ...input, status: 'active' } })) },
    })
    const membership = await updateOrganizationMembership({ membership: { id: 'mem-1', organizationId: 'org-1', userId: 'user-1', role: 'owner' } }, {
      eventBus,
      repository: { createMembership: vi.fn(async (input) => ({ ok: true, membership: input })) },
    })

    expect(organization.billingEnabled).toBe(false)
    expect(membership.auditRecord.category).toBe('organization_lifecycle')
    expect(organizationEvents[0]).toBe(organization)
    expect(membershipEvents[0]).toBe(membership)
  })
})

describe('Phase 27E organization-aware workspace access', () => {
  it('grants and denies organization-scoped workspace access with default deny', () => {
    const user = { id: 'user-1', role: 'viewer' }
    const membership = { id: 'mem-1', organizationId: 'org-1', userId: 'user-1', role: 'admin', status: 'active' }
    const granted = resolveWorkspaceAccess({ user, membership, organizationId: 'org-1', requestedOrganizationId: 'org-1', action: 'write' }, { emitEvent: false })
    const crossOrg = resolveWorkspaceAccess({ user, membership, organizationId: 'org-1', requestedOrganizationId: 'org-2', action: 'read' }, { emitEvent: false })
    const missing = resolveWorkspaceAccess({ user, action: 'read' }, { emitEvent: false })

    expect(granted.eventType).toBe(SYSTEM_ORGANIZATION_WORKSPACE_ACCESS_EVALUATED_EVENT)
    expect(granted.accessStatus).toBe('approved')
    expect(crossOrg.crossOrganizationAccessDenied).toBe(true)
    expect(crossOrg.accessStatus).toBe('rejected')
    expect(missing.workspaceAccessResolver.missingContext).toBe(true)
  })

  it('fails unauthenticated, missing organization, and cross-organization API requests safely', async () => {
    const handler = createProtectedOrganizationWorkspaceConfigurationsHandler({
      repositoryFactory: () => createMockPersistenceRepository(),
      organizationMembershipRepository: createMockMembershipRepository(),
      env: { TRADING_MODE: 'paper' },
    })

    const unauthenticated = parseResponse(await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { organizationId: 'org-1' } }))
    const missingOrganization = parseResponse(await handler(authEvent('GET')))
    const crossOrganization = parseResponse(await handler(authEvent('GET', {}, { organizationId: 'org-1', requestedOrganizationId: 'org-2' })))

    expect(unauthenticated.statusCode).toBe(401)
    expect(unauthenticated.json.error.message).toBe('authentication required')
    expect(missingOrganization.statusCode).toBe(403)
    expect(missingOrganization.json.error.message).toBe('organization context is required')
    expect(crossOrganization.statusCode).toBe(403)
    expect(crossOrganization.json.error.message).toBe('organization access denied')
  })

  it('serves organization-aware protected API routes', async () => {
    const routeOptions = {
      repositoryFactory: () => createMockPersistenceRepository(),
      organizationRepository: { getOrganization: vi.fn(async (id) => ({ id, name: 'Atlas Org', status: 'active' })) },
      organizationMembershipRepository: createMockMembershipRepository(),
      env: { TRADING_MODE: 'paper' },
    }
    const responses = [
      parseResponse(await createCurrentOrganizationHandler(routeOptions)(authEvent('GET', {}, { organizationId: 'org-1' }))),
      parseResponse(await createOrganizationMembershipsHandler(routeOptions)(authEvent('GET', {}, { organizationId: 'org-1' }))),
      parseResponse(await createProtectedOrganizationWorkspaceConfigurationsHandler(routeOptions)(authEvent('GET', {}, { organizationId: 'org-1' }))),
      parseResponse(await createOrganizationAuthorizationHealthHandler(routeOptions)(authEvent('GET', {}, { organizationId: 'org-1' }))),
    ]

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200])
    expect(responses[0].json.data.event.endpoint).toBe('current-organization')
    expect(responses[1].json.data.memberships[0].role).toBe('owner')
    expect(responses[2].json.data.workspaceAccess).toBe('approved')
    expect(responses[3].json.data.crossOrganizationAccessDenied).toBe(false)
    expect(responses.every((response) => response.json.data.liveOrders === false)).toBe(true)
  })
})

describe('Phase 27F identity and organization operations panel engine', () => {
  it('summarizes identity, organization, membership, authorization, session, and workspace access health', () => {
    const result = evaluateIdentityOrganizationOperations({
      userIdentity: { id: 'user-1', role: 'owner', provider: 'local-development' },
      organization: { id: 'org-1', name: 'Atlas Org', status: 'healthy' },
      membership: { id: 'mem-1', role: 'owner', status: 'active' },
      authorization: { eventType: 'system.authorization.evaluated', authorizationStatus: 'approved' },
      session: { id: 'session-1', status: 'active', expiresAt: '2026-07-10T13:00:00.000Z' },
      organizationWorkspaceAccess: { eventType: 'system.organizationWorkspaceAccess.evaluated', accessStatus: 'approved', workspace: { id: 'workspace-1', organizationId: 'org-1' } },
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_IDENTITY_ORGANIZATION_OPERATIONS_EVALUATED_EVENT)
    expect(result.operationalStatus).toBe('healthy')
    expect(result.authenticatedUserSummary.role).toBe('owner')
    expect(result.protectedWorkspaceAccessSummary.crossOrganizationAccessDenied).toBe(false)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })
})
