import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ORGANIZATION_WORKSPACE_READINESS_EVALUATED_EVENT = 'system.organizationWorkspaceReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildOrganizationProfilePlaceholder(multiUserWorkspacePlanning = {}) {
  const organization = multiUserWorkspacePlanning.futureOrganizationModelPlaceholder ?? {}
  return {
    organizationId: organization.organizationId ?? 'future-atlas-organization',
    organizationName: organization.organizationName ?? 'Future Atlas Organization',
    modelStatus: 'placeholder',
    persisted: false,
    realOrganizationEnabled: false,
    realAccountsEnabled: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
  }
}

function buildWorkspaceOwnershipReadiness(multiUserWorkspacePlanning = {}) {
  const ownership = multiUserWorkspacePlanning.workspaceOwnershipPlanning ?? {}
  return {
    plannedOwnerRole: ownership.plannedOwnerRole ?? 'owner',
    ownerMembershipCount: ownership.ownerMemberships?.length ?? 0,
    ownershipTransferEnabled: false,
    permissionEnforcementEnabled: false,
    status: ownership.plannedOwnerRole === 'owner' ? 'ready' : 'caution',
  }
}

function buildTeamWorkspaceReadiness(multiUserWorkspacePlanning = {}) {
  const workspace = multiUserWorkspacePlanning.futureTeamWorkspaceModelPlaceholder ?? {}
  const sharedAccess = multiUserWorkspacePlanning.sharedWorkspaceAccessPlanning ?? {}
  return {
    teamWorkspaceId: workspace.teamWorkspaceId ?? 'future-team-workspace',
    plannedSharedRoles: sharedAccess.plannedSharedRoles ?? [],
    modelStatus: workspace.modelStatus ?? 'missing',
    sharingEnabled: false,
    realUsersEnabled: false,
    status: workspace.modelStatus === 'placeholder' ? 'ready' : 'caution',
  }
}

function buildDependencySummaries(input = {}) {
  const roleAndPermissionDependencySummary = {
    authReadinessStatus: input.authReadiness?.authReadinessStatus ?? 'unknown',
    permissionReadinessStatus: input.permissionPlanning?.permissionReadinessStatus ?? 'unknown',
    multiUserReadinessStatus: input.multiUserWorkspacePlanning?.multiUserReadinessStatus ?? 'unknown',
    permissionsEnforced: false,
  }
  const auditDependencySummary = {
    auditIntegrityStatus: input.enterpriseAuditTrail?.auditIntegrityStatus?.status ?? 'unknown',
    auditRecordCount: input.enterpriseAuditTrail?.normalizedAuditRecords?.length ?? 0,
  }
  const persistenceDependencySummary = {
    persistenceStatus: input.workspacePersistence?.persistenceStatus ?? 'unknown',
    adapterType: input.workspacePersistence?.localPersistenceAdapter?.adapterType ?? 'local',
    multiUserPersistenceEnabled: false,
  }
  const releaseControlDependencySummary = {
    platformHealthStatus: input.systemHealthCommandCenter?.finalPlatformHealthStatus ?? 'unknown',
    releaseControlStatus: input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown',
  }
  return {
    roleAndPermissionDependencySummary,
    auditDependencySummary,
    persistenceDependencySummary,
    releaseControlDependencySummary,
  }
}

function resolveOrganizationReadinessStatus(dependencies) {
  const { roleAndPermissionDependencySummary: role, auditDependencySummary: audit, persistenceDependencySummary: persistence, releaseControlDependencySummary: release } = dependencies
  if (
    role.authReadinessStatus === 'blocked'
    || role.permissionReadinessStatus === 'blocked'
    || role.multiUserReadinessStatus === 'blocked'
    || audit.auditIntegrityStatus === 'invalid'
    || persistence.persistenceStatus === 'blocked'
    || release.platformHealthStatus === 'degraded'
    || release.releaseControlStatus === 'blocked'
  ) return 'blocked'

  if (
    role.authReadinessStatus !== 'ready'
    || role.permissionReadinessStatus !== 'ready'
    || role.multiUserReadinessStatus !== 'ready'
    || audit.auditIntegrityStatus !== 'valid'
    || persistence.persistenceStatus !== 'prepared'
    || release.platformHealthStatus !== 'operational'
    || release.releaseControlStatus !== 'release-ready'
  ) return 'caution'

  return 'ready'
}

export function evaluateOrganizationWorkspaceReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const organizationProfilePlaceholder = buildOrganizationProfilePlaceholder(input.multiUserWorkspacePlanning)
  const workspaceOwnershipReadiness = buildWorkspaceOwnershipReadiness(input.multiUserWorkspacePlanning)
  const teamWorkspaceReadiness = buildTeamWorkspaceReadiness(input.multiUserWorkspacePlanning)
  const dependencies = buildDependencySummaries(input)
  const organizationReadinessStatus = resolveOrganizationReadinessStatus(dependencies)
  const result = {
    eventType: SYSTEM_ORGANIZATION_WORKSPACE_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    realAuthenticationEnabled: false,
    realOrganizationsEnabled: false,
    realMultiUserAccountsEnabled: false,
    permissionEnforcementEnabled: false,
    signInUiEnabled: false,
    organizationProfilePlaceholder,
    workspaceOwnershipReadiness,
    teamWorkspaceReadiness,
    ...dependencies,
    organizationReadinessStatus,
    summary: `Organization workspace readiness ${organizationReadinessStatus}: ownership, team workspace, and enterprise dependencies reviewed without enabling organizations or accounts.`,
    sourceEvents: {
      authReadiness: input.authReadiness?.eventType ?? null,
      permissionPlanning: input.permissionPlanning?.eventType ?? null,
      multiUserWorkspacePlanning: input.multiUserWorkspacePlanning?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_ORGANIZATION_WORKSPACE_READINESS_EVALUATED_EVENT, result)
  }
  return result
}

export function createOrganizationWorkspaceReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateOrganizationWorkspaceReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
