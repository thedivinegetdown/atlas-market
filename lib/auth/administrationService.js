import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { normalizeMembership } from './organizationRepository.js'
import { normalizeTeamMembership, normalizeTeamWorkspace } from './teamWorkspaceRepository.js'

export const SYSTEM_ORGANIZATION_ADMINISTRATION_UPDATED_EVENT = 'system.organizationAdministration.updated'
export const SYSTEM_TEAM_WORKSPACE_ADMINISTRATION_UPDATED_EVENT = 'system.teamWorkspaceAdministration.updated'

const ROLE_RANK = Object.freeze({ viewer: 1, analyst: 2, admin: 3, owner: 4 })

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function canAdminister(actorRole) {
  return actorRole === 'owner' || actorRole === 'admin'
}

function createAuditRecord({ id, eventType, actor, action, timestamp, source }) {
  return {
    id,
    category: 'administration',
    severity: action.includes('rejected') ? 'medium' : 'low',
    actor,
    source,
    eventType,
    timestamp,
    summary: `Administration action: ${action}.`,
    eventChainReferences: [eventType],
    operatorActionReferences: [],
    strategyLifecycleReferences: [],
    riskDecisionReferences: [],
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

export function validateOwnershipTransfer({ actorRole, targetRole, activeOwnerCount = 1 }) {
  if (actorRole !== 'owner') return { valid: false, reason: 'ownership transfer requires owner role' }
  if (targetRole !== 'owner') return { valid: false, reason: 'target role must be owner' }
  if (activeOwnerCount <= 1) return { valid: false, reason: 'final owner cannot be removed or demoted' }
  return { valid: true, reason: 'ownership transfer validation passed' }
}

export async function updateOrganizationAdministration(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const actorMembership = normalizeMembership(input.actorMembership)
  const organizationId = input.organizationId ?? input.organization?.id
  const requestedOrganizationId = input.requestedOrganizationId ?? organizationId
  const action = input.action ?? 'profile-update'
  let status = 'ready'
  let error = null
  let resultPayload = input.organization ?? null

  if (!canAdminister(actorMembership.role)) {
    status = 'blocked'
    error = { code: 'admin_role_required', message: 'owner or admin role required' }
  } else if (!organizationId || organizationId !== requestedOrganizationId || actorMembership.organizationId !== organizationId) {
    status = 'blocked'
    error = { code: 'cross_organization_administration_denied', message: 'cross-organization administration denied' }
  } else if (action === 'ownership-transfer') {
    const validation = validateOwnershipTransfer({
      actorRole: actorMembership.role,
      targetRole: input.targetRole ?? 'owner',
      activeOwnerCount: input.activeOwnerCount ?? 1,
    })
    if (!validation.valid) {
      status = 'blocked'
      error = { code: 'ownership_transfer_denied', message: validation.reason }
    } else {
      resultPayload = { plannedOwnerUserId: input.targetUserId, validation }
    }
  } else if (action === 'membership-role-update' && input.currentMembership?.role === 'owner' && input.role !== 'owner' && (input.activeOwnerCount ?? 1) <= 1) {
    status = 'blocked'
    error = { code: 'final_owner_protected', message: 'final owner cannot be removed or demoted' }
  } else if (action === 'profile-update') {
    resultPayload = await options.organizationRepository?.createOrganization?.({
      ...input.organization,
      id: organizationId,
    }) ?? { ok: true, organization: input.organization }
  } else if (action === 'membership-role-update') {
    resultPayload = await options.membershipRepository?.updateMembershipRole?.(organizationId, input.userId, input.role)
  } else if (action === 'membership-suspend') {
    resultPayload = await options.membershipRepository?.revokeMembership?.(organizationId, input.userId)
  } else if (action === 'membership-reactivate') {
    resultPayload = await options.membershipRepository?.createMembership?.({
      id: input.membershipId,
      organizationId,
      userId: input.userId,
      role: input.role ?? 'viewer',
      status: 'active',
    })
  }

  const result = {
    eventType: SYSTEM_ORGANIZATION_ADMINISTRATION_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    action,
    organizationId,
    administrationStatus: status,
    result: resultPayload,
    finalOwnerProtection: error?.code === 'final_owner_protected',
    crossOrganizationAdministrationDenied: error?.code === 'cross_organization_administration_denied',
    ownershipTransferPlanning: {
      ownerOnly: true,
      adminCanTransferOwnership: false,
      requested: action === 'ownership-transfer',
    },
    auditRecord: createAuditRecord({
      id: `audit-org-admin-${organizationId}-${action}`,
      eventType: SYSTEM_ORGANIZATION_ADMINISTRATION_UPDATED_EVENT,
      actor: actorMembership.userId,
      action: `${action}${status === 'blocked' ? ' rejected' : ''}`,
      timestamp,
      source: 'organization-administration-service',
    }),
    error,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ORGANIZATION_ADMINISTRATION_UPDATED_EVENT, result)
  return result
}

export async function updateTeamWorkspaceAdministration(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const actorMembership = normalizeMembership(input.actorMembership)
  const teamWorkspace = normalizeTeamWorkspace(input.teamWorkspace)
  const teamMembership = normalizeTeamMembership(input.teamMembership)
  const action = input.action ?? 'team-profile-update'
  let status = 'ready'
  let error = null
  let resultPayload = teamWorkspace

  if (!canAdminister(actorMembership.role)) {
    status = 'blocked'
    error = { code: 'admin_role_required', message: 'owner or admin role required' }
  } else if (actorMembership.organizationId !== teamWorkspace.organizationId || teamMembership.organizationId !== teamWorkspace.organizationId) {
    status = 'blocked'
    error = { code: 'cross_organization_administration_denied', message: 'cross-organization administration denied' }
  } else if (action === 'team-archive') {
    resultPayload = await options.teamWorkspaceRepository?.archiveWorkspace?.(teamWorkspace.id) ?? { ok: true, workspace: { ...teamWorkspace, status: 'archived' } }
  } else if (action === 'team-restore') {
    resultPayload = await options.teamWorkspaceRepository?.createWorkspace?.({ ...teamWorkspace, status: 'active', archivedAt: null }) ?? { ok: true, workspace: { ...teamWorkspace, status: 'active' } }
  } else if (action === 'team-profile-update') {
    resultPayload = await options.teamWorkspaceRepository?.updateWorkspace?.(teamWorkspace.id, input.updates) ?? { ok: true, workspace: { ...teamWorkspace, ...(input.updates ?? {}) } }
  } else if (action === 'team-membership-role-update') {
    resultPayload = await options.teamMembershipRepository?.updateMembershipRole?.(teamWorkspace.id, input.userId, input.role)
  } else if (action === 'team-membership-suspend') {
    resultPayload = await options.teamMembershipRepository?.revokeMembership?.(teamWorkspace.id, input.userId)
  } else if (action === 'team-membership-reactivate') {
    resultPayload = await options.teamMembershipRepository?.createMembership?.({
      id: input.membershipId,
      organizationId: teamWorkspace.organizationId,
      teamWorkspaceId: teamWorkspace.id,
      userId: input.userId,
      role: input.role ?? 'viewer',
      status: 'active',
    })
  }

  const result = {
    eventType: SYSTEM_TEAM_WORKSPACE_ADMINISTRATION_UPDATED_EVENT,
    timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
    action,
    teamWorkspaceId: teamWorkspace.id,
    administrationStatus: status,
    result: resultPayload,
    crossOrganizationAdministrationDenied: error?.code === 'cross_organization_administration_denied',
    elevatedRoleReview: ROLE_RANK[input.role] >= ROLE_RANK.admin,
    auditRecord: createAuditRecord({
      id: `audit-team-admin-${teamWorkspace.id}-${action}`,
      eventType: SYSTEM_TEAM_WORKSPACE_ADMINISTRATION_UPDATED_EVENT,
      actor: actorMembership.userId,
      action: `${action}${status === 'blocked' ? ' rejected' : ''}`,
      timestamp,
      source: 'team-workspace-administration-service',
    }),
    error,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TEAM_WORKSPACE_ADMINISTRATION_UPDATED_EVENT, result)
  return result
}
