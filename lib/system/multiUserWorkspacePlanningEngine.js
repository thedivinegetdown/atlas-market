import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_MULTI_USER_WORKSPACE_PLANNING_EVALUATED_EVENT = 'system.multiUserWorkspacePlanning.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildFutureOrganizationModelPlaceholder(input = {}) {
  return {
    organizationId: input.organizationId ?? 'future-atlas-organization',
    organizationName: input.organizationName ?? 'Future Atlas Organization',
    modelStatus: 'placeholder',
    persisted: false,
    authenticationRequired: false,
    multiUserAccountsEnabled: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function buildFutureTeamWorkspaceModelPlaceholder({ workspacePersistence = {}, organization = {} }) {
  return {
    teamWorkspaceId: workspacePersistence.workspacePersistenceModel?.workspaceId ?? 'future-team-workspace',
    organizationId: organization.organizationId,
    modelStatus: 'placeholder',
    sharedLayoutEnabled: false,
    sharedTemplatesEnabled: false,
    sharedCommandPaletteEnabled: false,
    persisted: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function buildUserMembershipModelPlaceholder({ authReadiness = {}, permissionPlanning = {}, organization = {}, teamWorkspace = {} }) {
  const roles = permissionPlanning.roleCapabilityMap?.map((role) => role.role)
    ?? authReadiness.roleModelPlaceholder?.map((role) => role.role)
    ?? ['owner', 'admin', 'analyst', 'viewer']
  return roles.map((role) => ({
    membershipId: `future-membership-${role}`,
    organizationId: organization.organizationId,
    teamWorkspaceId: teamWorkspace.teamWorkspaceId,
    role,
    membershipStatus: 'placeholder',
    authenticated: false,
    permissionsEnforced: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }))
}

function buildWorkspaceOwnershipPlanning({ futureOrganizationModelPlaceholder, userMembershipModelPlaceholder }) {
  return {
    plannedOwnerRole: 'owner',
    organizationId: futureOrganizationModelPlaceholder.organizationId,
    ownerMemberships: userMembershipModelPlaceholder.filter((membership) => membership.role === 'owner').map((membership) => membership.membershipId),
    ownershipTransferEnabled: false,
    enforcementEnabled: false,
    paperTrading: true,
  }
}

function buildSharedWorkspaceAccessPlanning({ permissionPlanning = {}, userMembershipModelPlaceholder = {} }) {
  const roleCapabilities = permissionPlanning.roleCapabilityMap ?? []
  return {
    plannedSharedRoles: userMembershipModelPlaceholder.map((membership) => membership.role),
    workspaceAccessRoles: permissionPlanning.workspaceAccessPlanning?.plannedRoles ?? [],
    releaseReviewRoles: permissionPlanning.releaseControlAccessPlanning?.plannedRoles ?? [],
    roleCapabilityCount: roleCapabilities.length,
    sharingEnabled: false,
    permissionEnforcementEnabled: false,
    paperTrading: true,
  }
}

function buildCollaborationBoundarySummary({ authReadiness = {}, permissionPlanning = {} }) {
  return {
    collaborationMode: 'planned-placeholder',
    realUsersEnabled: false,
    authenticationEnabled: false,
    permissionEnforcementEnabled: false,
    multiUserPersistenceEnabled: false,
    workspaceCommentsEnabled: false,
    sharedOperatorActionsEnabled: false,
    authReadinessStatus: authReadiness.authReadinessStatus ?? 'unknown',
    permissionReadinessStatus: permissionPlanning.permissionReadinessStatus ?? 'unknown',
    deniedCollaborationActions: [
      'user.invite',
      'workspace.share.persist',
      'permission.enforce',
      'auth.signIn',
      'broker.order.share',
    ],
  }
}

function buildAuditAndPermissionDependencySummary({ enterpriseAuditTrail = {}, permissionPlanning = {}, systemHealthCommandCenter = {}, enterpriseReleaseControl = {} }) {
  return {
    auditTrailStatus: enterpriseAuditTrail.auditIntegrityStatus?.status ?? 'unknown',
    auditRecordCount: enterpriseAuditTrail.normalizedAuditRecords?.length ?? 0,
    permissionReadinessStatus: permissionPlanning.permissionReadinessStatus ?? 'unknown',
    systemHealthStatus: systemHealthCommandCenter.finalPlatformHealthStatus ?? 'unknown',
    releaseControlStatus: enterpriseReleaseControl.finalReleaseStatus ?? 'unknown',
    dependenciesReady: [
      enterpriseAuditTrail.auditIntegrityStatus?.status === 'valid',
      permissionPlanning.permissionReadinessStatus === 'ready',
      systemHealthCommandCenter.finalPlatformHealthStatus === 'operational',
      enterpriseReleaseControl.finalReleaseStatus === 'release-ready',
    ].every(Boolean),
  }
}

function resolveMultiUserReadinessStatus({ authReadiness = {}, permissionPlanning = {}, collaborationBoundarySummary, auditAndPermissionDependencySummary }) {
  if (
    authReadiness.authReadinessStatus === 'blocked'
    || permissionPlanning.permissionReadinessStatus === 'blocked'
    || collaborationBoundarySummary.authenticationEnabled
    || collaborationBoundarySummary.permissionEnforcementEnabled
  ) return 'blocked'

  if (
    authReadiness.authReadinessStatus === 'caution'
    || permissionPlanning.permissionReadinessStatus === 'caution'
    || auditAndPermissionDependencySummary.dependenciesReady === false
  ) return 'caution'

  return 'ready'
}

export function evaluateMultiUserWorkspacePlanning(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const futureOrganizationModelPlaceholder = buildFutureOrganizationModelPlaceholder(input.futureOrganization)
  const futureTeamWorkspaceModelPlaceholder = buildFutureTeamWorkspaceModelPlaceholder({
    workspacePersistence: input.workspacePersistence,
    organization: futureOrganizationModelPlaceholder,
  })
  const userMembershipModelPlaceholder = buildUserMembershipModelPlaceholder({
    authReadiness: input.authReadiness,
    permissionPlanning: input.permissionPlanning,
    organization: futureOrganizationModelPlaceholder,
    teamWorkspace: futureTeamWorkspaceModelPlaceholder,
  })
  const workspaceOwnershipPlanning = buildWorkspaceOwnershipPlanning({
    futureOrganizationModelPlaceholder,
    userMembershipModelPlaceholder,
  })
  const sharedWorkspaceAccessPlanning = buildSharedWorkspaceAccessPlanning({
    permissionPlanning: input.permissionPlanning,
    userMembershipModelPlaceholder,
  })
  const collaborationBoundarySummary = buildCollaborationBoundarySummary({
    authReadiness: input.authReadiness,
    permissionPlanning: input.permissionPlanning,
  })
  const auditAndPermissionDependencySummary = buildAuditAndPermissionDependencySummary({
    enterpriseAuditTrail: input.enterpriseAuditTrail,
    permissionPlanning: input.permissionPlanning,
    systemHealthCommandCenter: input.systemHealthCommandCenter,
    enterpriseReleaseControl: input.enterpriseReleaseControl,
  })
  const multiUserReadinessStatus = resolveMultiUserReadinessStatus({
    authReadiness: input.authReadiness,
    permissionPlanning: input.permissionPlanning,
    collaborationBoundarySummary,
    auditAndPermissionDependencySummary,
  })
  const result = {
    eventType: SYSTEM_MULTI_USER_WORKSPACE_PLANNING_EVALUATED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    realAuthenticationEnabled: false,
    realMultiUserAccountsEnabled: false,
    permissionEnforcementEnabled: false,
    signInUiEnabled: false,
    timestamp,
    futureOrganizationModelPlaceholder,
    futureTeamWorkspaceModelPlaceholder,
    userMembershipModelPlaceholder,
    workspaceOwnershipPlanning,
    sharedWorkspaceAccessPlanning,
    collaborationBoundarySummary,
    auditAndPermissionDependencySummary,
    multiUserReadinessStatus,
    summary: `Multi-user workspace planning ${multiUserReadinessStatus}: organization, team workspace, and membership placeholders prepared without enabling real users.`,
    sourceEvents: {
      authReadiness: input.authReadiness?.eventType ?? null,
      permissionPlanning: input.permissionPlanning?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_MULTI_USER_WORKSPACE_PLANNING_EVALUATED_EVENT, result)
  }

  return result
}

export function createMultiUserWorkspacePlanningEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateMultiUserWorkspacePlanning(input, { ...options, ...evaluationOptions })
    },
  }
}
