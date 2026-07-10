import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { createDatabaseAdapter } from '../db/postgresRepository.js'

export const SYSTEM_ORGANIZATION_PERSISTED_EVENT = 'system.organization.persisted'
export const SYSTEM_ORGANIZATION_MEMBERSHIP_UPDATED_EVENT = 'system.organizationMembership.updated'

const SAFE_ROLES = Object.freeze(['owner', 'admin', 'analyst', 'viewer'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function normalizeOrganization(input = {}) {
  return {
    id: String(input.id ?? 'org-atlas-local'),
    name: String(input.name ?? 'Atlas Local Organization'),
    status: input.status ?? 'active',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    createdByUserId: input.createdByUserId ?? input.created_by_user_id ?? null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
  }
}

export function normalizeMembership(input = {}) {
  return {
    id: String(input.id ?? `membership-${input.organizationId ?? input.organization_id}-${input.userId ?? input.user_id}`),
    organizationId: String(input.organizationId ?? input.organization_id ?? 'org-atlas-local'),
    userId: String(input.userId ?? input.user_id ?? 'local-development:local-operator'),
    role: SAFE_ROLES.includes(input.role) ? input.role : 'viewer',
    status: input.status ?? 'active',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    revokedAt: input.revokedAt ?? input.revoked_at ?? null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

function createAuditRecord(id, eventType, actor, action, timestamp, references = {}) {
  return {
    id,
    category: 'organization_lifecycle',
    severity: action.includes('revoked') ? 'medium' : 'low',
    actor,
    source: 'organization-repository',
    eventType,
    timestamp,
    summary: `Organization lifecycle action: ${action}.`,
    eventChainReferences: [eventType],
    operatorActionReferences: references.operatorActionReferences ?? [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function rowToOrganization(row = {}) {
  return normalizeOrganization({
    id: row.id,
    name: row.name,
    status: row.status,
    metadata: row.metadata,
    createdByUserId: row.created_by_user_id,
  })
}

function rowToMembership(row = {}) {
  return normalizeMembership({
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    metadata: row.metadata,
    revokedAt: row.revoked_at,
  })
}

export function createOrganizationRepository({ database } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  return {
    connected: adapter.connected,
    async createOrganization(organization) {
      const normalized = normalizeOrganization(organization)
      if (!adapter.connected) return { ok: true, disabled: true, organization: normalized }
      const result = await adapter.query(
        `INSERT INTO atlas_organizations (id, name, status, metadata, created_by_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id)
         DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING id, name, status, metadata, created_by_user_id`,
        [normalized.id, normalized.name, normalized.status, normalized.metadata, normalized.createdByUserId],
      )
      return { ok: true, organization: rowToOrganization(result.rows?.[0] ?? normalized) }
    },
    async getOrganization(organizationId) {
      if (!adapter.connected) return null
      const result = await adapter.query('SELECT id, name, status, metadata, created_by_user_id FROM atlas_organizations WHERE id = $1', [organizationId])
      return result.rows?.[0] ? rowToOrganization(result.rows[0]) : null
    },
  }
}

export function createOrganizationMembershipRepository({ database } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  async function activeOwnerCount(organizationId) {
    if (!adapter.connected) return 1
    const result = await adapter.query(
      'SELECT COUNT(*)::int AS count FROM atlas_organization_memberships WHERE organization_id = $1 AND role = $2 AND status = $3',
      [organizationId, 'owner', 'active'],
    )
    return Number(result.rows?.[0]?.count ?? 0)
  }
  async function activeMembershipForUser(organizationId, userId) {
    if (!adapter.connected) return null
    const result = await adapter.query(
      'SELECT id, organization_id, user_id, role, status, metadata, revoked_at FROM atlas_organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = $3',
      [organizationId, userId, 'active'],
    )
    return result.rows?.[0] ? rowToMembership(result.rows[0]) : null
  }
  return {
    connected: adapter.connected,
    activeOwnerCount,
    async createMembership(membership) {
      const normalized = normalizeMembership(membership)
      const existing = await activeMembershipForUser(normalized.organizationId, normalized.userId)
      if (existing) {
        return { ok: false, error: { code: 'duplicate_active_membership', message: 'active membership already exists' }, membership: existing }
      }
      if (!adapter.connected) return { ok: true, disabled: true, membership: normalized }
      const result = await adapter.query(
        `INSERT INTO atlas_organization_memberships (id, organization_id, user_id, role, status, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id, organization_id, user_id, role, status, metadata, revoked_at`,
        [normalized.id, normalized.organizationId, normalized.userId, normalized.role, normalized.status, normalized.metadata],
      )
      return { ok: true, membership: rowToMembership(result.rows?.[0] ?? normalized) }
    },
    async getMembership(organizationId, userId) {
      return activeMembershipForUser(organizationId, userId)
    },
    async listMemberships(organizationId) {
      if (!adapter.connected) return []
      const result = await adapter.query(
        'SELECT id, organization_id, user_id, role, status, metadata, revoked_at FROM atlas_organization_memberships WHERE organization_id = $1 ORDER BY created_at ASC',
        [organizationId],
      )
      return (result.rows ?? []).map(rowToMembership)
    },
    async updateMembershipRole(organizationId, userId, role) {
      if (!SAFE_ROLES.includes(role)) return { ok: false, error: { code: 'invalid_role', message: 'membership role is invalid' } }
      const current = await activeMembershipForUser(organizationId, userId)
      if (!current) return { ok: false, error: { code: 'membership_not_found', message: 'membership not found' } }
      if (current.role === 'owner' && role !== 'owner' && await activeOwnerCount(organizationId) <= 1) {
        return { ok: false, error: { code: 'final_owner_protected', message: 'final owner cannot be removed' }, membership: current }
      }
      if (!adapter.connected) return { ok: true, disabled: true, membership: { ...current, role } }
      const result = await adapter.query(
        'UPDATE atlas_organization_memberships SET role = $3, updated_at = NOW() WHERE organization_id = $1 AND user_id = $2 AND status = $4 RETURNING id, organization_id, user_id, role, status, metadata, revoked_at',
        [organizationId, userId, role, 'active'],
      )
      return { ok: true, membership: rowToMembership(result.rows?.[0] ?? { ...current, role }) }
    },
    async revokeMembership(organizationId, userId) {
      const current = await activeMembershipForUser(organizationId, userId)
      if (!current) return { ok: false, error: { code: 'membership_not_found', message: 'membership not found' } }
      if (current.role === 'owner' && await activeOwnerCount(organizationId) <= 1) {
        return { ok: false, error: { code: 'final_owner_protected', message: 'final owner cannot be removed' }, membership: current }
      }
      if (!adapter.connected) return { ok: true, disabled: true, membership: { ...current, status: 'revoked' } }
      const result = await adapter.query(
        'UPDATE atlas_organization_memberships SET status = $3, revoked_at = NOW(), updated_at = NOW() WHERE organization_id = $1 AND user_id = $2 AND status = $4 RETURNING id, organization_id, user_id, role, status, metadata, revoked_at',
        [organizationId, userId, 'revoked', 'active'],
      )
      return { ok: true, membership: rowToMembership(result.rows?.[0] ?? { ...current, status: 'revoked' }) }
    },
  }
}

export async function persistOrganization(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const repository = options.repository ?? createOrganizationRepository(options)
  const response = await repository.createOrganization(input.organization)
  const result = {
    eventType: SYSTEM_ORGANIZATION_PERSISTED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    organization: response.organization,
    auditRecord: createAuditRecord(`audit-org-${response.organization.id}`, SYSTEM_ORGANIZATION_PERSISTED_EVENT, response.organization.createdByUserId, 'organization persisted', timestamp),
    status: response.ok ? 'ready' : 'blocked',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ORGANIZATION_PERSISTED_EVENT, result)
  return result
}

export async function updateOrganizationMembership(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const repository = options.repository ?? createOrganizationMembershipRepository(options)
  const action = input.action ?? 'create'
  const response = action === 'revoke'
    ? await repository.revokeMembership(input.organizationId, input.userId)
    : action === 'update'
      ? await repository.updateMembershipRole(input.organizationId, input.userId, input.role)
      : await repository.createMembership(input.membership)
  const membership = response.membership ?? normalizeMembership(input.membership ?? input)
  const result = {
    eventType: SYSTEM_ORGANIZATION_MEMBERSHIP_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    membershipAction: action,
    membership,
    ownershipProtection: {
      finalOwnerProtected: response.error?.code === 'final_owner_protected',
      duplicateActiveMembershipPrevented: response.error?.code === 'duplicate_active_membership',
    },
    auditRecord: createAuditRecord(`audit-membership-${membership.id}`, SYSTEM_ORGANIZATION_MEMBERSHIP_UPDATED_EVENT, membership.userId, `membership ${action}${response.ok ? '' : ' rejected'}`, timestamp),
    status: response.ok ? 'ready' : 'blocked',
    error: response.error ?? null,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ORGANIZATION_MEMBERSHIP_UPDATED_EVENT, result)
  return result
}
