import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { createDatabaseAdapter } from '../db/postgresRepository.js'

export const SYSTEM_TEAM_WORKSPACE_PERSISTED_EVENT = 'system.teamWorkspace.persisted'
export const SYSTEM_TEAM_WORKSPACE_MEMBERSHIP_UPDATED_EVENT = 'system.teamWorkspaceMembership.updated'

const SAFE_ROLES = Object.freeze(['owner', 'admin', 'analyst', 'viewer'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function normalizeTeamWorkspace(input = {}) {
  return {
    id: String(input.id ?? 'team-atlas-local'),
    organizationId: String(input.organizationId ?? input.organization_id ?? 'org-atlas-local'),
    name: String(input.name ?? 'Atlas Team Workspace'),
    status: input.status ?? 'active',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    createdByUserId: input.createdByUserId ?? input.created_by_user_id ?? null,
    archivedAt: input.archivedAt ?? input.archived_at ?? null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
  }
}

export function normalizeTeamMembership(input = {}) {
  return {
    id: String(input.id ?? `team-membership-${input.teamWorkspaceId ?? input.team_workspace_id}-${input.userId ?? input.user_id}`),
    organizationId: String(input.organizationId ?? input.organization_id ?? 'org-atlas-local'),
    teamWorkspaceId: String(input.teamWorkspaceId ?? input.team_workspace_id ?? 'team-atlas-local'),
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

function createAuditRecord(id, eventType, actor, action, timestamp) {
  return {
    id,
    category: 'team_workspace_lifecycle',
    severity: action.includes('revoked') || action.includes('archived') ? 'medium' : 'low',
    actor,
    source: 'team-workspace-repository',
    eventType,
    timestamp,
    summary: `Team workspace lifecycle action: ${action}.`,
    eventChainReferences: [eventType],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function rowToTeamWorkspace(row = {}) {
  return normalizeTeamWorkspace({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    status: row.status,
    metadata: row.metadata,
    createdByUserId: row.created_by_user_id,
    archivedAt: row.archived_at,
  })
}

function rowToTeamMembership(row = {}) {
  return normalizeTeamMembership({
    id: row.id,
    organizationId: row.organization_id,
    teamWorkspaceId: row.team_workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    metadata: row.metadata,
    revokedAt: row.revoked_at,
  })
}

export function createTeamWorkspaceRepository({ database } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  return {
    connected: adapter.connected,
    async createWorkspace(workspace) {
      const normalized = normalizeTeamWorkspace(workspace)
      if (!normalized.organizationId) return { ok: false, error: { code: 'organization_required', message: 'team workspace requires organization' } }
      if (!adapter.connected) return { ok: true, disabled: true, workspace: normalized }
      const result = await adapter.query(
        `INSERT INTO atlas_team_workspaces (id, organization_id, name, status, metadata, created_by_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id)
         DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING id, organization_id, name, status, metadata, created_by_user_id, archived_at`,
        [normalized.id, normalized.organizationId, normalized.name, normalized.status, normalized.metadata, normalized.createdByUserId],
      )
      return { ok: true, workspace: rowToTeamWorkspace(result.rows?.[0] ?? normalized) }
    },
    async getWorkspace(teamWorkspaceId) {
      if (!adapter.connected) return null
      const result = await adapter.query('SELECT id, organization_id, name, status, metadata, created_by_user_id, archived_at FROM atlas_team_workspaces WHERE id = $1', [teamWorkspaceId])
      return result.rows?.[0] ? rowToTeamWorkspace(result.rows[0]) : null
    },
    async updateWorkspace(teamWorkspaceId, updates = {}) {
      if (!adapter.connected) return { ok: true, disabled: true, workspace: normalizeTeamWorkspace({ id: teamWorkspaceId, ...updates }) }
      const result = await adapter.query(
        'UPDATE atlas_team_workspaces SET name = COALESCE($2, name), metadata = COALESCE($3, metadata), updated_at = NOW() WHERE id = $1 RETURNING id, organization_id, name, status, metadata, created_by_user_id, archived_at',
        [teamWorkspaceId, updates.name ?? null, updates.metadata ?? null],
      )
      return { ok: true, workspace: rowToTeamWorkspace(result.rows?.[0]) }
    },
    async archiveWorkspace(teamWorkspaceId) {
      if (!adapter.connected) return { ok: true, disabled: true, workspace: normalizeTeamWorkspace({ id: teamWorkspaceId, status: 'archived' }) }
      const result = await adapter.query(
        'UPDATE atlas_team_workspaces SET status = $2, archived_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, organization_id, name, status, metadata, created_by_user_id, archived_at',
        [teamWorkspaceId, 'archived'],
      )
      return { ok: true, workspace: rowToTeamWorkspace(result.rows?.[0]) }
    },
  }
}

export function createTeamMembershipRepository({ database, organizationMembershipRepository } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  async function activeMembership(teamWorkspaceId, userId) {
    if (!adapter.connected) return null
    const result = await adapter.query(
      'SELECT id, organization_id, team_workspace_id, user_id, role, status, metadata, revoked_at FROM atlas_team_workspace_memberships WHERE team_workspace_id = $1 AND user_id = $2 AND status = $3',
      [teamWorkspaceId, userId, 'active'],
    )
    return result.rows?.[0] ? rowToTeamMembership(result.rows[0]) : null
  }
  return {
    connected: adapter.connected,
    async createMembership(membership) {
      const normalized = normalizeTeamMembership(membership)
      const orgMembership = await organizationMembershipRepository?.getMembership?.(normalized.organizationId, normalized.userId)
      if (organizationMembershipRepository && (!orgMembership || orgMembership.organizationId !== normalized.organizationId)) {
        return { ok: false, error: { code: 'cross_organization_team_membership', message: 'team membership must match organization membership' } }
      }
      const existing = await activeMembership(normalized.teamWorkspaceId, normalized.userId)
      if (existing) return { ok: false, error: { code: 'duplicate_active_team_membership', message: 'active team membership already exists' }, membership: existing }
      if (!adapter.connected) return { ok: true, disabled: true, membership: normalized }
      const result = await adapter.query(
        `INSERT INTO atlas_team_workspace_memberships (id, organization_id, team_workspace_id, user_id, role, status, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING id, organization_id, team_workspace_id, user_id, role, status, metadata, revoked_at`,
        [normalized.id, normalized.organizationId, normalized.teamWorkspaceId, normalized.userId, normalized.role, normalized.status, normalized.metadata],
      )
      return { ok: true, membership: rowToTeamMembership(result.rows?.[0] ?? normalized) }
    },
    async getMembership(teamWorkspaceId, userId) {
      return activeMembership(teamWorkspaceId, userId)
    },
    async listMemberships(teamWorkspaceId) {
      if (!adapter.connected) return []
      const result = await adapter.query(
        'SELECT id, organization_id, team_workspace_id, user_id, role, status, metadata, revoked_at FROM atlas_team_workspace_memberships WHERE team_workspace_id = $1 ORDER BY created_at ASC',
        [teamWorkspaceId],
      )
      return (result.rows ?? []).map(rowToTeamMembership)
    },
    async updateMembershipRole(teamWorkspaceId, userId, role) {
      if (!SAFE_ROLES.includes(role)) return { ok: false, error: { code: 'invalid_role', message: 'team membership role is invalid' } }
      if (!adapter.connected) return { ok: true, disabled: true, membership: normalizeTeamMembership({ teamWorkspaceId, userId, role }) }
      const result = await adapter.query(
        'UPDATE atlas_team_workspace_memberships SET role = $3, updated_at = NOW() WHERE team_workspace_id = $1 AND user_id = $2 AND status = $4 RETURNING id, organization_id, team_workspace_id, user_id, role, status, metadata, revoked_at',
        [teamWorkspaceId, userId, role, 'active'],
      )
      return { ok: true, membership: rowToTeamMembership(result.rows?.[0]) }
    },
    async revokeMembership(teamWorkspaceId, userId) {
      if (!adapter.connected) return { ok: true, disabled: true, membership: normalizeTeamMembership({ teamWorkspaceId, userId, status: 'revoked' }) }
      const result = await adapter.query(
        'UPDATE atlas_team_workspace_memberships SET status = $3, revoked_at = NOW(), updated_at = NOW() WHERE team_workspace_id = $1 AND user_id = $2 AND status = $4 RETURNING id, organization_id, team_workspace_id, user_id, role, status, metadata, revoked_at',
        [teamWorkspaceId, userId, 'revoked', 'active'],
      )
      return { ok: true, membership: rowToTeamMembership(result.rows?.[0]) }
    },
  }
}

export async function persistTeamWorkspace(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const repository = options.repository ?? createTeamWorkspaceRepository(options)
  const action = input.action ?? 'create'
  const response = action === 'archive'
    ? await repository.archiveWorkspace(input.teamWorkspaceId)
    : action === 'update'
      ? await repository.updateWorkspace(input.teamWorkspaceId, input.updates)
      : await repository.createWorkspace(input.workspace)
  const workspace = response.workspace ?? normalizeTeamWorkspace(input.workspace)
  const result = {
    eventType: SYSTEM_TEAM_WORKSPACE_PERSISTED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    action,
    teamWorkspace: workspace,
    auditRecord: createAuditRecord(`audit-team-workspace-${workspace.id}`, SYSTEM_TEAM_WORKSPACE_PERSISTED_EVENT, workspace.createdByUserId, `team workspace ${action}`, timestamp),
    status: response.ok ? 'ready' : 'blocked',
    error: response.error ?? null,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TEAM_WORKSPACE_PERSISTED_EVENT, result)
  return result
}

export async function updateTeamMembership(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const repository = options.repository ?? createTeamMembershipRepository(options)
  const action = input.action ?? 'create'
  const response = action === 'revoke'
    ? await repository.revokeMembership(input.teamWorkspaceId, input.userId)
    : action === 'update'
      ? await repository.updateMembershipRole(input.teamWorkspaceId, input.userId, input.role)
      : await repository.createMembership(input.membership)
  const membership = response.membership ?? normalizeTeamMembership(input.membership ?? input)
  const result = {
    eventType: SYSTEM_TEAM_WORKSPACE_MEMBERSHIP_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    action,
    teamMembership: membership,
    boundaryProtection: {
      crossOrganizationPrevented: response.error?.code === 'cross_organization_team_membership',
      duplicateActiveTeamMembershipPrevented: response.error?.code === 'duplicate_active_team_membership',
    },
    auditRecord: createAuditRecord(`audit-team-membership-${membership.id}`, SYSTEM_TEAM_WORKSPACE_MEMBERSHIP_UPDATED_EVENT, membership.userId, `team membership ${action}${response.ok ? '' : ' rejected'}`, timestamp),
    status: response.ok ? 'ready' : 'blocked',
    error: response.error ?? null,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TEAM_WORKSPACE_MEMBERSHIP_UPDATED_EVENT, result)
  return result
}
