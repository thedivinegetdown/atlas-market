import { createHash, randomUUID } from 'node:crypto'
import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { createDatabaseAdapter } from '../db/postgresRepository.js'

export const SYSTEM_MEMBERSHIP_INVITATION_UPDATED_EVENT = 'system.membershipInvitation.updated'

const SAFE_ROLES = Object.freeze(['owner', 'admin', 'analyst', 'viewer'])
const SAFE_STATUSES = Object.freeze(['pending', 'accepted', 'expired', 'revoked'])
const ROLE_RANK = Object.freeze({ viewer: 1, analyst: 2, admin: 3, owner: 4 })

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(String(token ?? '')).digest('hex')
}

export function normalizeInvitation(input = {}) {
  const role = SAFE_ROLES.includes(input.role) ? input.role : 'viewer'
  const status = SAFE_STATUSES.includes(input.status) ? input.status : 'pending'
  const tokenHash = input.tokenHash ?? input.token_hash ?? hashInvitationToken(input.token ?? randomUUID())
  return {
    id: String(input.id ?? `invitation-${randomUUID()}`),
    organizationId: String(input.organizationId ?? input.organization_id ?? 'org-atlas-local'),
    teamWorkspaceId: input.teamWorkspaceId ?? input.team_workspace_id ?? null,
    inviteeEmail: input.inviteeEmail ?? input.invitee_email ?? null,
    role,
    status,
    tokenHash,
    invitedByUserId: input.invitedByUserId ?? input.invited_by_user_id ?? null,
    acceptedByUserId: input.acceptedByUserId ?? input.accepted_by_user_id ?? null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    expiresAt: getNowIso(input.expiresAt ?? input.expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    acceptedAt: input.acceptedAt ?? input.accepted_at ?? null,
    revokedAt: input.revokedAt ?? input.revoked_at ?? null,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function validateInvitationRole(inviterRole, invitationRole) {
  if (!SAFE_ROLES.includes(invitationRole)) return { valid: false, reason: 'invalid invitation role' }
  if ((ROLE_RANK[invitationRole] ?? 0) > (ROLE_RANK[inviterRole] ?? 0)) return { valid: false, reason: 'invitation role exceeds inviter privileges' }
  return { valid: true, reason: 'role assignment is allowed' }
}

function createAuditRecord(id, action, actor, timestamp) {
  return {
    id,
    category: 'membership_invitation',
    severity: action.includes('revoked') || action.includes('expired') ? 'medium' : 'low',
    actor,
    source: 'invitation-repository',
    eventType: SYSTEM_MEMBERSHIP_INVITATION_UPDATED_EVENT,
    timestamp,
    summary: `Membership invitation action: ${action}.`,
    eventChainReferences: [SYSTEM_MEMBERSHIP_INVITATION_UPDATED_EVENT],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function rowToInvitation(row = {}) {
  return normalizeInvitation({
    id: row.id,
    organizationId: row.organization_id,
    teamWorkspaceId: row.team_workspace_id,
    inviteeEmail: row.invitee_email,
    role: row.role,
    status: row.status,
    tokenHash: row.token_hash,
    invitedByUserId: row.invited_by_user_id,
    acceptedByUserId: row.accepted_by_user_id,
    metadata: row.metadata,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  })
}

function publicInvitation(invitation) {
  const { tokenHash, token, ...safeInvitation } = invitation
  void tokenHash
  void token
  return safeInvitation
}

export function createInvitationRepository({ database } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  return {
    connected: adapter.connected,
    async createInvitation(invitation, { inviterRole = 'viewer' } = {}) {
      const normalized = normalizeInvitation(invitation)
      const roleValidation = validateInvitationRole(inviterRole, normalized.role)
      if (!roleValidation.valid) return { ok: false, error: { code: 'invitation_role_not_allowed', message: roleValidation.reason }, invitation: publicInvitation(normalized) }
      if (!adapter.connected) return { ok: true, disabled: true, invitation: publicInvitation(normalized), tokenHash: normalized.tokenHash }
      const result = await adapter.query(
        `INSERT INTO atlas_membership_invitations (id, organization_id, team_workspace_id, invitee_email, role, status, token_hash, invited_by_user_id, metadata, expires_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         RETURNING id, organization_id, team_workspace_id, invitee_email, role, status, token_hash, invited_by_user_id, accepted_by_user_id, metadata, expires_at, accepted_at, revoked_at`,
        [
          normalized.id,
          normalized.organizationId,
          normalized.teamWorkspaceId,
          normalized.inviteeEmail,
          normalized.role,
          normalized.status,
          normalized.tokenHash,
          normalized.invitedByUserId,
          normalized.metadata,
          normalized.expiresAt,
        ],
      )
      const saved = rowToInvitation(result.rows?.[0] ?? normalized)
      return { ok: true, invitation: publicInvitation(saved), tokenHash: saved.tokenHash }
    },
    async findByToken(token) {
      if (!adapter.connected) return null
      const result = await adapter.query(
        'SELECT id, organization_id, team_workspace_id, invitee_email, role, status, token_hash, invited_by_user_id, accepted_by_user_id, metadata, expires_at, accepted_at, revoked_at FROM atlas_membership_invitations WHERE token_hash = $1',
        [hashInvitationToken(token)],
      )
      return result.rows?.[0] ? rowToInvitation(result.rows[0]) : null
    },
    async listInvitations({ organizationId, teamWorkspaceId } = {}) {
      if (!adapter.connected) return []
      const result = teamWorkspaceId
        ? await adapter.query(
          'SELECT id, organization_id, team_workspace_id, invitee_email, role, status, token_hash, invited_by_user_id, accepted_by_user_id, metadata, expires_at, accepted_at, revoked_at FROM atlas_membership_invitations WHERE organization_id = $1 AND team_workspace_id = $2 ORDER BY created_at DESC',
          [organizationId, teamWorkspaceId],
        )
        : await adapter.query(
          'SELECT id, organization_id, team_workspace_id, invitee_email, role, status, token_hash, invited_by_user_id, accepted_by_user_id, metadata, expires_at, accepted_at, revoked_at FROM atlas_membership_invitations WHERE organization_id = $1 ORDER BY created_at DESC',
          [organizationId],
        )
      return (result.rows ?? []).map(rowToInvitation).map(publicInvitation)
    },
    async acceptInvitation(token, acceptedByUserId, now = new Date()) {
      const invitation = await this.findByToken(token)
      if (!invitation) return { ok: false, error: { code: 'invitation_not_found', message: 'invitation not found' } }
      if (invitation.status !== 'pending') return { ok: false, error: { code: `invitation_${invitation.status}`, message: `invitation is ${invitation.status}` }, invitation: publicInvitation(invitation) }
      if (new Date(invitation.expiresAt).getTime() <= new Date(now).getTime()) return { ok: false, error: { code: 'invitation_expired', message: 'invitation is expired' }, invitation: publicInvitation({ ...invitation, status: 'expired' }) }
      if (!adapter.connected) return { ok: true, disabled: true, invitation: publicInvitation({ ...invitation, status: 'accepted', acceptedByUserId }) }
      const result = await adapter.query(
        'UPDATE atlas_membership_invitations SET status = $2, accepted_by_user_id = $3, accepted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, organization_id, team_workspace_id, invitee_email, role, status, token_hash, invited_by_user_id, accepted_by_user_id, metadata, expires_at, accepted_at, revoked_at',
        [invitation.id, 'accepted', acceptedByUserId],
      )
      return { ok: true, invitation: publicInvitation(rowToInvitation(result.rows?.[0] ?? { ...invitation, status: 'accepted', acceptedByUserId })) }
    },
    async revokeInvitation(invitationId) {
      if (!adapter.connected) return { ok: true, disabled: true, invitation: { id: invitationId, status: 'revoked' } }
      const result = await adapter.query(
        'UPDATE atlas_membership_invitations SET status = $2, revoked_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, organization_id, team_workspace_id, invitee_email, role, status, token_hash, invited_by_user_id, accepted_by_user_id, metadata, expires_at, accepted_at, revoked_at',
        [invitationId, 'revoked'],
      )
      return { ok: true, invitation: publicInvitation(rowToInvitation(result.rows?.[0])) }
    },
  }
}

export async function updateMembershipInvitation(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const repository = options.repository ?? createInvitationRepository(options)
  const action = input.action ?? 'create'
  const response = action === 'accept'
    ? await repository.acceptInvitation(input.token, input.acceptedByUserId, options.now?.() ?? new Date())
    : action === 'revoke'
      ? await repository.revokeInvitation(input.invitationId)
      : await repository.createInvitation(input.invitation, { inviterRole: input.inviterRole })
  const invitation = publicInvitation(response.invitation ?? normalizeInvitation(input.invitation))
  const result = {
    eventType: SYSTEM_MEMBERSHIP_INVITATION_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    action,
    invitation,
    tokenHashStored: Boolean(response.tokenHash),
    rawTokenReturned: false,
    roleAssignmentValidation: action === 'create' ? validateInvitationRole(input.inviterRole ?? 'viewer', invitation.role) : { valid: true },
    auditRecord: createAuditRecord(`audit-invitation-${invitation.id}`, `invitation ${action}${response.ok ? '' : ' rejected'}`, invitation.invitedByUserId ?? invitation.acceptedByUserId, timestamp),
    status: response.ok ? 'ready' : 'blocked',
    error: response.error ?? null,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_MEMBERSHIP_INVITATION_UPDATED_EVENT, result)
  return result
}
