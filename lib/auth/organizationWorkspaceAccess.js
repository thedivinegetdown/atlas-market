import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { evaluateAuthorization } from './authorizationService.js'

export const SYSTEM_ORGANIZATION_WORKSPACE_ACCESS_EVALUATED_EVENT = 'system.organizationWorkspaceAccess.evaluated'

const WORKSPACE_PERMISSION_BY_ACTION = Object.freeze({
  read: 'dashboard.read',
  write: 'workspace.admin',
  administer: 'workspace.admin',
  own: 'workspace.owner',
})

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function resolveWorkspaceAccess(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const user = input.user ?? null
  const organizationId = input.organizationId ?? input.workspace?.organizationId ?? null
  const requestedOrganizationId = input.requestedOrganizationId ?? organizationId
  const workspace = {
    id: input.workspaceId ?? input.workspace?.id ?? 'atlas-paper-operator-workspace',
    organizationId,
    ownerUserId: input.workspace?.ownerUserId ?? null,
  }
  const membership = input.membership ?? null
  const action = input.action ?? 'read'
  const requestedPermission = WORKSPACE_PERMISSION_BY_ACTION[action] ?? 'dashboard.read'
  const missingContext = !user?.id || !organizationId || !membership
  const organizationBoundaryValidation = {
    organizationId,
    requestedOrganizationId,
    valid: Boolean(organizationId && requestedOrganizationId && organizationId === requestedOrganizationId),
  }
  const crossOrganizationAccessDenied = organizationBoundaryValidation.valid === false
  const membershipAuthorizationCheck = {
    membershipId: membership?.id ?? null,
    role: membership?.role ?? null,
    active: membership?.status === 'active',
    organizationMatches: membership?.organizationId === organizationId,
    userMatches: membership?.userId === user?.id,
  }
  const scopedUser = user && membership
    ? {
      ...user,
      role: membership.role,
      metadata: {
        ...(user.metadata ?? {}),
        ownedWorkspaceIds: membership.role === 'owner' ? [workspace.id] : user.metadata?.ownedWorkspaceIds,
      },
    }
    : user
  const baseAuthorization = evaluateAuthorization({
    user: scopedUser,
    permission: requestedPermission,
    workspaceId: workspace.id,
    organizationId,
    requestId: input.requestId,
    routeId: input.routeId,
  }, { emitEvent: false, timestamp: options.timestamp })
  const allowed = !missingContext
    && !crossOrganizationAccessDenied
    && membershipAuthorizationCheck.active
    && membershipAuthorizationCheck.organizationMatches
    && membershipAuthorizationCheck.userMatches
    && baseAuthorization.allowed
  const accessStatus = allowed ? 'approved' : 'rejected'
  const result = {
    eventType: SYSTEM_ORGANIZATION_WORKSPACE_ACCESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    action,
    requestedPermission,
    userId: user?.id ?? null,
    workspace,
    organizationScopedWorkspaceOwnership: {
      workspaceId: workspace.id,
      organizationId,
      ownerRoleRequired: action === 'own',
      ownerUserId: workspace.ownerUserId,
    },
    membershipAuthorizationCheck,
    workspaceAccessResolver: {
      defaultDeny: true,
      missingContext,
      allowed,
      reason: allowed
        ? 'organization workspace access granted'
        : missingContext
          ? 'organization context is missing'
          : crossOrganizationAccessDenied
            ? 'cross-organization access denied'
            : 'membership or role is not authorized',
    },
    ownerAdminAnalystViewerWorkspacePermissions: {
      owner: ['read', 'write', 'administer', 'own'],
      admin: ['read', 'write', 'administer'],
      analyst: ['read'],
      viewer: ['read'],
    },
    organizationBoundaryValidation,
    crossOrganizationAccessDenied,
    baseAuthorization,
    accessStatus,
    sourceEvents: {
      authorization: baseAuthorization.eventType,
      organizationMembership: input.membershipEventType ?? null,
      multiUserWorkspacePlanning: input.multiUserWorkspacePlanning?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_ORGANIZATION_WORKSPACE_ACCESS_EVALUATED_EVENT, result)
  return result
}
