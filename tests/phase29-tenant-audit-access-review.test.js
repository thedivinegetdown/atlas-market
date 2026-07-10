import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createPostgresRepository } from '../lib/db/postgresRepository.js'
import {
  SYSTEM_TENANT_ISOLATION_EVALUATED_EVENT,
  assertTenantScope,
  evaluateTenantIsolation,
  listTenantOperatorActions,
  listTenantSystemEvents,
  resolveTenantContext,
  upsertTenantWorkspaceConfiguration,
} from '../lib/auth/tenantIsolation.js'
import {
  SYSTEM_ADMINISTRATIVE_AUDIT_RECORDED_EVENT,
  lookupAdministrativeAudit,
  normalizeAdministrativeAuditRecord,
  recordAdministrativeChange,
} from '../lib/system/administrativeAuditService.js'
import {
  SYSTEM_ACCESS_REVIEW_EVALUATED_EVENT,
  evaluateAccessReview,
} from '../lib/system/accessReviewEngine.js'
import { createAdministrativeAuditHandler } from '../netlify/functions/administrative-audit.js'

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
      'x-request-id': 'req-phase29',
      'x-atlas-dev-role': role,
    },
    queryStringParameters: query,
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function createMockPersistenceRepository(records = []) {
  const store = {
    listScoped: vi.fn(async () => records),
    upsertScoped: vi.fn(async (id, payload, tenantContext) => ({ ok: true, data: { id, payload, tenantContext } })),
  }
  return {
    getStore: vi.fn(() => store),
    end: vi.fn(async () => {}),
    store,
  }
}

const tenantContext = {
  organizationId: 'org-1',
  teamWorkspaceId: 'team-1',
  userId: 'local-development:local-operator',
  role: 'owner',
}

const organizationMembership = {
  id: 'membership-org-1-owner',
  organizationId: 'org-1',
  userId: 'local-development:local-operator',
  role: 'owner',
  status: 'active',
}

function routeOptions(overrides = {}) {
  const repository = createMockPersistenceRepository([
    {
      id: 'audit-1',
      payload: {
        id: 'audit-1',
        category: 'membership',
        actor: 'local-development:local-operator',
        before: { role: 'viewer' },
        after: { role: 'analyst' },
      },
    },
  ])
  return {
    repositoryFactory: () => repository,
    organizationMembershipRepository: {
      getMembership: vi.fn(async () => organizationMembership),
    },
    env: { TRADING_MODE: 'paper' },
    ...overrides,
  }
}

describe('Phase 29A tenant-scoped data isolation foundation', () => {
  it('adds idempotent tenant ownership columns and safe tenant indexes', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS organization_id')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS team_workspace_id')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_workspace_configurations_tenant')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_atlas_audit_records_tenant')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
  })

  it('resolves tenant context from authenticated membership and denies cross-tenant access', () => {
    const resolved = resolveTenantContext({
      user: { id: 'user-1' },
      organizationMembership: { organizationId: 'org-1', userId: 'user-1', role: 'analyst' },
      requestedOrganizationId: 'org-1',
    })
    const denied = resolveTenantContext({
      user: { id: 'user-1' },
      organizationMembership: { organizationId: 'org-1', userId: 'user-1', role: 'analyst' },
      requestedOrganizationId: 'org-2',
    })

    expect(resolved.allowed).toBe(true)
    expect(denied.allowed).toBe(false)
    expect(denied.crossOrganizationDenied).toBe(true)
    expect(() => assertTenantScope({ organizationId: null })).toThrow('tenant context is required')
  })

  it('enforces parameterized tenant-aware scoped repository access', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createPostgresRepository({ database: { connected: true, query, healthCheck: vi.fn(), transaction: vi.fn() } })

    await upsertTenantWorkspaceConfiguration(repository, 'workspace-1', { layout: 'ops' }, tenantContext)
    await listTenantSystemEvents(repository, tenantContext, { limit: 10 })
    await listTenantOperatorActions(repository, tenantContext, { limit: 10 })

    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    expect(query.mock.calls[0][0]).toContain('organization_id')
    expect(query.mock.calls[1][0]).toContain('WHERE organization_id = $1')
  })

  it('emits tenant boundary audit records', () => {
    const result = evaluateTenantIsolation({
      ...tenantContext,
      requestedTeamWorkspaceId: 'team-2',
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_TENANT_ISOLATION_EVALUATED_EVENT)
    expect(result.tenantIsolationStatus).toBe('blocked')
    expect(result.crossTeamDenied).toBe(true)
    expect(result.tenantBoundaryAuditRecords[0].category).toBe('tenant_boundary')
  })
})

describe('Phase 29B administrative audit and change history', () => {
  it('normalizes safe administrative audit snapshots without secrets, tokens, or hashes', () => {
    const record = normalizeAdministrativeAuditRecord({
      category: 'session',
      tenantContext,
      before: { status: 'active', tokenHash: 'hash', token: 'raw-token', secret: 'secret' },
      after: { status: 'revoked', secret: 'sensitive-value' },
    })

    expect(record.category).toBe('session')
    expect(record.sensitiveMaterialExcluded).toBe(true)
    expect(JSON.stringify(record)).not.toContain('raw-token')
    expect(JSON.stringify(record)).not.toContain('hash')
    expect(JSON.stringify(record)).not.toContain('secret')
    expect(JSON.stringify(record)).not.toContain('sensitive-value')
  })

  it('records and looks up tenant-scoped administrative audit history', async () => {
    const repository = createMockPersistenceRepository([{ id: 'audit-1', payload: { id: 'audit-1', category: 'membership', actor: tenantContext.userId } }])
    const recorded = await recordAdministrativeChange({
      id: 'audit-1',
      category: 'membership',
      tenantContext,
      before: { role: 'viewer' },
      after: { role: 'analyst' },
    }, { repository, emitEvent: false })
    const lookup = await lookupAdministrativeAudit({
      tenantContext,
      query: { actor: tenantContext.userId, category: 'membership', limit: 25, sort: 'created_at' },
    }, { repository })

    expect(recorded.eventType).toBe(SYSTEM_ADMINISTRATIVE_AUDIT_RECORDED_EVENT)
    expect(repository.store.upsertScoped).toHaveBeenCalledWith('audit-1', expect.any(Object), expect.objectContaining({ organizationId: 'org-1' }))
    expect(lookup.records).toHaveLength(1)
    expect(lookup.pagination.limit).toBe(25)
    expect(lookup.sensitiveMaterialExcluded).toBe(true)
  })

  it('serves protected administrative audit only to owner/admin roles', async () => {
    const owner = parseResponse(await createAdministrativeAuditHandler(routeOptions())(authEvent('GET', {}, { organizationId: 'org-1', limit: '10' }, 'owner')))
    const analystOptions = routeOptions({
      organizationMembershipRepository: {
        getMembership: vi.fn(async () => ({ ...organizationMembership, role: 'analyst' })),
      },
    })
    const analyst = parseResponse(await createAdministrativeAuditHandler(analystOptions)(authEvent('GET', {}, { organizationId: 'org-1' }, 'analyst')))

    expect(owner.statusCode).toBe(200)
    expect(owner.json.data.tokenHashesExposed).toBe(false)
    expect(owner.json.data.invitationHashesExposed).toBe(false)
    expect(owner.json.data.sensitiveSessionMaterialExposed).toBe(false)
    expect(analyst.statusCode).toBe(403)
  })
})

describe('Phase 29C periodic access review engine', () => {
  it('reviews memberships, sessions, invitations, and orphaned workspaces without automatic changes', () => {
    const result = evaluateAccessReview({
      tenantIsolation: evaluateTenantIsolation(tenantContext, { emitEvent: false }),
      collaborationGovernance: { eventType: 'system.collaborationGovernance.evaluated' },
      sessionSecurity: { eventType: 'system.sessionSecurity.evaluated', activeSessionListing: [{ id: 'session-1', status: 'revoked' }] },
      organizationMemberships: [
        { id: 'owner-1', organizationId: 'org-1', userId: 'owner', role: 'owner', status: 'active' },
        { id: 'admin-1', organizationId: 'org-1', userId: 'admin', role: 'admin', status: 'suspended' },
      ],
      teamMemberships: [
        { id: 'team-viewer-1', organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'viewer', role: 'viewer', status: 'active' },
      ],
      invitations: [
        { id: 'invite-1', status: 'pending' },
        { id: 'invite-2', status: 'expired' },
      ],
      teamWorkspaces: [
        { id: 'team-1' },
        { id: 'team-orphaned' },
      ],
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_ACCESS_REVIEW_EVALUATED_EVENT)
    expect(result.reviewStatus).toBe('blocked')
    expect(result.reviewFindings.map((item) => item.severity)).toEqual(expect.arrayContaining(['informational', 'caution', 'critical']))
    expect(result.automaticRoleChanges).toBe(false)
    expect(result.automaticMembershipRevocation).toBe(false)
    expect(result.automaticSessionRevocation).toBe(false)
  })
})
