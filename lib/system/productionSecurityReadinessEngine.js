import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_SECURITY_READINESS_EVALUATED_EVENT = 'system.securityReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildSecuritySummaries(input = {}) {
  const deploymentSecurity = input.productionDeploymentReadiness?.apiSecurityReadinessSummary ?? {}
  const paperSafety = input.productionDeploymentReadiness?.paperTradingSafetyDeploymentSummary ?? {}
  const market = input.marketDataAdapterHealth ?? {}
  const broker = input.brokerAdapterHealth ?? {}
  const persistence = input.productionDeploymentReadiness?.postgresqlReadinessSummary ?? {}
  const audit = input.enterpriseAuditTrail ?? {}
  const observability = input.eventObservability ?? {}
  return {
    environmentSecretHandlingSummary: {
      status: deploymentSecurity.secretsConfigured === true ? 'ready' : 'caution',
      secretsConfigured: deploymentSecurity.secretsConfigured === true,
      secretValuesExposed: false,
      secretValuesIncluded: false,
      storageStrategy: deploymentSecurity.secretsConfigured === true ? 'environment-managed' : 'planning-required',
    },
    apiBoundarySecuritySummary: {
      status: deploymentSecurity.status ?? 'unknown',
      authReadinessStatus: input.authReadiness?.authReadinessStatus ?? 'unknown',
      permissionPlanningStatus: input.permissionPlanning?.permissionReadinessStatus ?? 'unknown',
      authenticationEnabled: false,
      permissionEnforcementEnabled: false,
      productionExposureEnabled: deploymentSecurity.productionExposureEnabled === true,
      deniedScopes: input.authReadiness?.permissionBoundarySummary?.deniedScopes ?? [],
    },
    paperTradingSafetyLockSummary: {
      status: paperSafety.status ?? 'unknown',
      tradingMode: paperSafety.tradingMode ?? input.authReadiness?.paperModeAccessBoundary?.tradingMode ?? 'paper',
      paperTrading: paperSafety.paperTrading !== false,
      liveOrders: paperSafety.liveOrders === true,
      brokerageIntegration: paperSafety.brokerageIntegration === true,
      safetyLockEnabled: paperSafety.tradingMode === 'paper' && !paperSafety.liveOrders && !paperSafety.brokerageIntegration,
    },
    adapterBrokerMockModeSecuritySummary: {
      status: market.health?.paperTrading !== false
        && broker.health?.paperTrading !== false
        && broker.health?.liveOrders !== true
        ? 'ready'
        : 'blocked',
      marketProvider: market.health?.provider ?? market.metadata?.id ?? 'unknown',
      brokerProvider: broker.health?.provider ?? broker.metadata?.id ?? 'unknown',
      marketPaperTrading: market.health?.paperTrading !== false,
      brokerPaperTrading: broker.health?.paperTrading !== false,
      liveOrders: broker.health?.liveOrders === true,
      mockModeRequired: true,
    },
    persistenceSecurityReadinessSummary: {
      status: persistence.status ?? 'unknown',
      postgresImplemented: persistence.implemented === true,
      databaseConfigured: persistence.databaseConfigured === true,
      multiUserSupport: persistence.multiUserSupport === true,
      productionCredentialsStored: false,
    },
    auditSecurityTraceabilitySummary: {
      status: audit.auditIntegrityStatus?.status ?? 'unknown',
      auditRecordCount: audit.normalizedAuditRecords?.length ?? 0,
      observabilityStatus: observability.observabilityStatus ?? 'unknown',
      criticalEventHealthStatus: observability.criticalEventHealthStatus?.status ?? 'unknown',
    },
    deploymentSecurityDependencySummary: {
      status: input.productionDeploymentReadiness?.deploymentReadinessStatus ?? 'unknown',
      saasReadinessStatus: input.enterpriseSaasReadiness?.saasReadinessStatus ?? 'unknown',
      releaseControlStatus: input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown',
      deploymentTriggered: input.productionDeploymentReadiness?.deploymentTriggered === true,
    },
  }
}

function resolveSecurityReadinessStatus(summaries) {
  const statuses = [
    summaries.environmentSecretHandlingSummary.status,
    summaries.apiBoundarySecuritySummary.status,
    summaries.paperTradingSafetyLockSummary.status,
    summaries.adapterBrokerMockModeSecuritySummary.status,
    summaries.persistenceSecurityReadinessSummary.status,
    summaries.auditSecurityTraceabilitySummary.status,
    summaries.auditSecurityTraceabilitySummary.observabilityStatus,
    summaries.deploymentSecurityDependencySummary.status,
    summaries.deploymentSecurityDependencySummary.saasReadinessStatus,
    summaries.deploymentSecurityDependencySummary.releaseControlStatus,
  ]
  const blockedStatuses = new Set(['blocked', 'invalid', 'degraded', 'failed'])
  if (
    statuses.some((status) => blockedStatuses.has(status))
    || summaries.environmentSecretHandlingSummary.secretValuesExposed
    || !summaries.paperTradingSafetyLockSummary.safetyLockEnabled
    || summaries.adapterBrokerMockModeSecuritySummary.liveOrders
  ) return 'blocked'

  const readyStatuses = new Set(['ready', 'healthy', 'valid', 'release-ready'])
  return statuses.every((status) => readyStatuses.has(status)) ? 'ready' : 'caution'
}

export function evaluateProductionSecurityReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const summaries = buildSecuritySummaries(input)
  const securityReadinessStatus = resolveSecurityReadinessStatus(summaries)
  const result = {
    eventType: SYSTEM_SECURITY_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    realAuthenticationEnabled: false,
    billingEnabled: false,
    secretsExposed: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    ...summaries,
    securityReadinessStatus,
    summary: `Production security readiness ${securityReadinessStatus}: secrets, API boundaries, paper safety, adapters, persistence, audit, and deployment dependencies reviewed without enabling production controls.`,
    sourceEvents: {
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      enterpriseSaasReadiness: input.enterpriseSaasReadiness?.eventType ?? null,
      authReadiness: input.authReadiness?.eventType ?? null,
      permissionPlanning: input.permissionPlanning?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      marketDataAdapterHealth: input.marketDataAdapterHealth?.eventType ?? null,
      brokerAdapterHealth: input.brokerAdapterHealth?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_SECURITY_READINESS_EVALUATED_EVENT, result)
  }
  return result
}

export function createProductionSecurityReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateProductionSecurityReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
