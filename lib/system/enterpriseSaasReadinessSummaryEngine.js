import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_SAAS_READINESS_EVALUATED_EVENT = 'system.saasReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildReadinessSummaries(input = {}) {
  return {
    authReadinessSummary: {
      status: input.authReadiness?.authReadinessStatus ?? 'unknown',
      roleCount: input.authReadiness?.roleModelPlaceholder?.length ?? 0,
      realAuthenticationEnabled: input.authReadiness?.realAuthenticationEnabled ?? false,
    },
    permissionPlanningSummary: {
      status: input.permissionPlanning?.permissionReadinessStatus ?? 'unknown',
      roleCapabilityCount: input.permissionPlanning?.roleCapabilityMap?.length ?? 0,
      permissionEnforcementEnabled: input.permissionPlanning?.permissionEnforcementEnabled ?? false,
    },
    multiUserWorkspaceSummary: {
      status: input.multiUserWorkspacePlanning?.multiUserReadinessStatus ?? 'unknown',
      membershipPlaceholderCount: input.multiUserWorkspacePlanning?.userMembershipModelPlaceholder?.length ?? 0,
      realMultiUserAccountsEnabled: input.multiUserWorkspacePlanning?.realMultiUserAccountsEnabled ?? false,
    },
    organizationWorkspaceSummary: {
      status: input.organizationWorkspaceReadiness?.organizationReadinessStatus ?? 'unknown',
      organizationId: input.organizationWorkspaceReadiness?.organizationProfilePlaceholder?.organizationId ?? null,
      realOrganizationsEnabled: input.organizationWorkspaceReadiness?.realOrganizationsEnabled ?? false,
    },
    persistenceReadinessSummary: {
      status: input.workspacePersistence?.persistenceStatus ?? 'unknown',
      localAdapterStatus: input.workspacePersistence?.localPersistenceAdapter?.status ?? 'unknown',
      postgresImplemented: input.workspacePersistence?.futurePostgresPersistenceInterface?.implemented ?? false,
      multiUserPersistenceEnabled: input.workspacePersistence?.multiUserSupport ?? false,
    },
    auditReadinessSummary: {
      status: input.enterpriseAuditTrail?.auditIntegrityStatus?.status ?? 'unknown',
      auditRecordCount: input.enterpriseAuditTrail?.normalizedAuditRecords?.length ?? 0,
    },
    releaseControlReadinessSummary: {
      status: input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown',
      platformHealthStatus: input.systemHealthCommandCenter?.finalPlatformHealthStatus ?? 'unknown',
    },
  }
}

function resolveSaasReadinessStatus(summaries) {
  const statuses = [
    summaries.authReadinessSummary.status,
    summaries.permissionPlanningSummary.status,
    summaries.multiUserWorkspaceSummary.status,
    summaries.organizationWorkspaceSummary.status,
    summaries.persistenceReadinessSummary.status,
    summaries.auditReadinessSummary.status,
    summaries.releaseControlReadinessSummary.status,
    summaries.releaseControlReadinessSummary.platformHealthStatus,
  ]
  const blockedStatuses = new Set(['blocked', 'invalid', 'degraded', 'failed'])
  if (statuses.some((status) => blockedStatuses.has(status))) return 'blocked'

  const readyStatuses = new Set(['ready', 'prepared', 'valid', 'release-ready', 'operational'])
  return statuses.every((status) => readyStatuses.has(status)) ? 'ready' : 'caution'
}

export function evaluateEnterpriseSaasReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const summaries = buildReadinessSummaries(input)
  const saasReadinessStatus = resolveSaasReadinessStatus(summaries)
  const result = {
    eventType: SYSTEM_SAAS_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    realAuthenticationEnabled: false,
    billingEnabled: false,
    realOrganizationsEnabled: false,
    realMultiUserAccountsEnabled: false,
    permissionEnforcementEnabled: false,
    ...summaries,
    saasReadinessStatus,
    summary: `Enterprise SaaS readiness ${saasReadinessStatus}: platform planning dependencies summarized without enabling SaaS features.`,
    sourceEvents: {
      authReadiness: input.authReadiness?.eventType ?? null,
      permissionPlanning: input.permissionPlanning?.eventType ?? null,
      multiUserWorkspacePlanning: input.multiUserWorkspacePlanning?.eventType ?? null,
      organizationWorkspaceReadiness: input.organizationWorkspaceReadiness?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_SAAS_READINESS_EVALUATED_EVENT, result)
  }
  return result
}

export function createEnterpriseSaasReadinessSummaryEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateEnterpriseSaasReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
