import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { resolveWorkspaceAccess } from './organizationWorkspaceAccess.js'
import { evaluateAuthorization } from './authorizationService.js'

export const SYSTEM_TEAM_WORKSPACE_ACCESS_EVALUATED_EVENT = 'system.teamWorkspaceAccess.evaluated'

const ACTION_PERMISSION = Object.freeze({
  read: 'dashboard.read',
  write: 'workspace.admin',
  invite: 'workspace.admin',
  administer: 'workspace.admin',
})

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function resolveTeamWorkspaceAccess(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const user = input.user ?? null
  const organizationMembership = input.organizationMembership ?? null
  const teamMembership = input.teamMembership ?? null
  const teamWorkspace = input.teamWorkspace ?? {
    id: input.teamWorkspaceId ?? null,
    organizationId: input.organizationId ?? null,
    status: 'active',
  }
  const requestedOrganizationId = input.requestedOrganizationId ?? teamWorkspace.organizationId
  const requestedTeamWorkspaceId = input.requestedTeamWorkspaceId ?? teamWorkspace.id
  const action = input.action ?? 'read'
  const organizationAccess = resolveWorkspaceAccess({
    user,
    membership: organizationMembership,
    organizationId: teamWorkspace.organizationId,
    requestedOrganizationId,
    workspaceId: teamWorkspace.id,
    action: action === 'read' ? 'read' : 'administer',
    requestId: input.requestId,
    routeId: input.routeId,
  }, { emitEvent: false, timestamp: options.timestamp })
  const teamBoundaryValidation = {
    organizationMatches: Boolean(teamMembership?.organizationId && teamMembership.organizationId === teamWorkspace.organizationId),
    teamMatches: Boolean(teamMembership?.teamWorkspaceId && teamMembership.teamWorkspaceId === teamWorkspace.id && requestedTeamWorkspaceId === teamWorkspace.id),
    teamActive: teamWorkspace.status !== 'archived',
  }
  const scopedUser = teamMembership
    ? {
      ...(user ?? {}),
      role: teamMembership.role,
    }
    : user
  const teamAuthorization = evaluateAuthorization({
    user: scopedUser,
    permission: ACTION_PERMISSION[action] ?? 'dashboard.read',
    workspaceId: teamWorkspace.id,
    organizationId: teamWorkspace.organizationId,
    teamWorkspaceId: teamWorkspace.id,
    requestId: input.requestId,
    routeId: input.routeId,
  }, { emitEvent: false, timestamp: options.timestamp })
  const missingContext = !user?.id || !teamWorkspace.organizationId || !teamWorkspace.id || !organizationMembership || !teamMembership
  const crossOrganizationAccessDenied = organizationAccess.crossOrganizationAccessDenied || teamBoundaryValidation.organizationMatches === false
  const crossTeamAccessDenied = teamBoundaryValidation.teamMatches === false
  const allowed = !missingContext
    && organizationAccess.workspaceAccessResolver.allowed
    && teamAuthorization.allowed
    && teamBoundaryValidation.organizationMatches
    && teamBoundaryValidation.teamMatches
    && teamBoundaryValidation.teamActive
    && teamMembership.status === 'active'
  const result = {
    eventType: SYSTEM_TEAM_WORKSPACE_ACCESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    action,
    userId: user?.id ?? null,
    teamWorkspace,
    organizationTeamMembershipComposition: {
      organizationMembershipId: organizationMembership?.id ?? null,
      organizationRole: organizationMembership?.role ?? null,
      teamMembershipId: teamMembership?.id ?? null,
      teamRole: teamMembership?.role ?? null,
    },
    teamWorkspaceAccessResolver: {
      defaultDeny: true,
      missingContext,
      allowed,
      reason: allowed
        ? 'team workspace access granted'
        : missingContext
          ? 'organization or team context is missing'
          : crossOrganizationAccessDenied
            ? 'cross-organization team access denied'
            : crossTeamAccessDenied
              ? 'cross-team access denied'
              : 'team membership or role is not authorized',
    },
    teamBoundaryValidation,
    ownerAdminAnalystViewerTeamPermissions: {
      owner: ['read', 'write', 'invite', 'administer'],
      admin: ['read', 'write', 'invite', 'administer'],
      analyst: ['read'],
      viewer: ['read'],
    },
    crossOrganizationAccessDenied,
    crossTeamAccessDenied,
    organizationAccess,
    teamAuthorization,
    accessStatus: allowed ? 'approved' : 'rejected',
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TEAM_WORKSPACE_ACCESS_EVALUATED_EVENT, result)
  return result
}
