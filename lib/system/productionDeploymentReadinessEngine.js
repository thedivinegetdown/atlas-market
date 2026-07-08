import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_DEPLOYMENT_READINESS_EVALUATED_EVENT = 'system.deploymentReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function findCheck(releaseReadiness = {}, name) {
  return releaseReadiness.checks?.find((check) => check.name === name) ?? {}
}

function buildReadinessSummaries(input = {}) {
  const environmentCheck = findCheck(input.releaseReadiness, 'environment')
  const paperSafetyCheck = findCheck(input.releaseReadiness, 'paperTradingSafety')
  const postgres = input.workspacePersistence?.futurePostgresPersistenceInterface ?? {}
  const netlify = input.netlifyConfiguration ?? {}
  const apiSecurity = input.apiSecurityConfiguration ?? {}
  return {
    environmentReadinessSummary: {
      status: environmentCheck.status ?? 'unknown',
      tradingMode: environmentCheck.tradingMode ?? 'paper',
      nodeEnv: environmentCheck.nodeEnv ?? 'unknown',
      databaseConfigured: environmentCheck.databaseConfigured ?? false,
    },
    netlifyDeploymentReadinessSummary: {
      status: netlify.configured === true && netlify.buildCommand && netlify.publishDirectory && netlify.functionsDirectory
        ? 'ready'
        : 'caution',
      configured: netlify.configured === true,
      buildCommand: netlify.buildCommand ?? null,
      publishDirectory: netlify.publishDirectory ?? null,
      functionsDirectory: netlify.functionsDirectory ?? null,
      deploymentTriggered: false,
    },
    postgresqlReadinessSummary: {
      status: postgres.implemented === true && environmentCheck.databaseConfigured === true ? 'ready' : 'caution',
      interfaceStatus: postgres.status ?? 'unknown',
      implemented: postgres.implemented === true,
      databaseConfigured: environmentCheck.databaseConfigured === true,
      multiUserSupport: postgres.multiUserSupport === true,
    },
    apiSecurityReadinessSummary: {
      status: apiSecurity.status ?? 'caution',
      authenticationStatus: input.enterpriseSaasReadiness?.authReadinessSummary?.status ?? 'unknown',
      authenticationEnabled: apiSecurity.authenticationEnabled === true,
      authorizationEnforced: apiSecurity.authorizationEnforced === true,
      secretsConfigured: apiSecurity.secretsConfigured === true,
      productionExposureEnabled: false,
    },
    observabilityReadinessSummary: {
      status: input.eventObservability?.observabilityStatus ?? 'unknown',
      criticalEventHealthStatus: input.eventObservability?.criticalEventHealthStatus ?? 'unknown',
      platformHealthStatus: input.systemHealthCommandCenter?.finalPlatformHealthStatus ?? 'unknown',
    },
    saasReadinessDependencySummary: {
      status: input.enterpriseSaasReadiness?.saasReadinessStatus ?? 'unknown',
      organizationWorkspaceStatus: input.organizationWorkspaceReadiness?.organizationReadinessStatus ?? 'unknown',
      billingEnabled: input.enterpriseSaasReadiness?.billingEnabled === true,
    },
    paperTradingSafetyDeploymentSummary: {
      status: paperSafetyCheck.status ?? 'unknown',
      tradingMode: environmentCheck.tradingMode ?? 'paper',
      paperTrading: input.enterpriseReleaseControl?.paperTrading !== false,
      liveOrders: input.enterpriseReleaseControl?.liveOrders === true,
      brokerageIntegration: input.enterpriseReleaseControl?.brokerageIntegration === true,
      deploymentCanExecuteOrders: false,
    },
    auditReadinessStatus: input.enterpriseAuditTrail?.auditIntegrityStatus?.status ?? 'unknown',
    releaseControlStatus: input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown',
  }
}

function resolveDeploymentReadinessStatus(summaries) {
  const statuses = [
    summaries.environmentReadinessSummary.status,
    summaries.netlifyDeploymentReadinessSummary.status,
    summaries.postgresqlReadinessSummary.status,
    summaries.apiSecurityReadinessSummary.status,
    summaries.observabilityReadinessSummary.status,
    summaries.observabilityReadinessSummary.platformHealthStatus,
    summaries.saasReadinessDependencySummary.status,
    summaries.saasReadinessDependencySummary.organizationWorkspaceStatus,
    summaries.paperTradingSafetyDeploymentSummary.status,
    summaries.auditReadinessStatus,
    summaries.releaseControlStatus,
  ]
  const blockedStatuses = new Set(['blocked', 'invalid', 'degraded', 'failed'])
  if (
    statuses.some((status) => blockedStatuses.has(status))
    || summaries.paperTradingSafetyDeploymentSummary.tradingMode !== 'paper'
    || summaries.paperTradingSafetyDeploymentSummary.liveOrders
    || summaries.paperTradingSafetyDeploymentSummary.brokerageIntegration
  ) return 'blocked'

  const readyStatuses = new Set(['ready', 'healthy', 'operational', 'valid', 'release-ready'])
  return statuses.every((status) => readyStatuses.has(status)) ? 'ready' : 'caution'
}

export function evaluateProductionDeploymentReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const summaries = buildReadinessSummaries(input)
  const deploymentReadinessStatus = resolveDeploymentReadinessStatus(summaries)
  const result = {
    eventType: SYSTEM_DEPLOYMENT_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    deploymentTriggered: false,
    billingEnabled: false,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    ...summaries,
    deploymentReadinessStatus,
    summary: `Production deployment readiness ${deploymentReadinessStatus}: environment, hosting, data, security, observability, SaaS, and paper-safety dependencies reviewed without deploying.`,
    sourceEvents: {
      releaseReadiness: input.releaseReadiness?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      enterpriseSaasReadiness: input.enterpriseSaasReadiness?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      organizationWorkspaceReadiness: input.organizationWorkspaceReadiness?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_DEPLOYMENT_READINESS_EVALUATED_EVENT, result)
  }
  return result
}

export function createProductionDeploymentReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateProductionDeploymentReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
