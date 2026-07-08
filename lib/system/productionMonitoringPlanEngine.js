import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_MONITORING_PLAN_GENERATED_EVENT = 'system.monitoringPlan.generated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'degraded', 'invalid', 'failed', 'critical', 'high'].includes(status)) return 'blocked'
  if (['ready', 'release-ready', 'healthy', 'operational', 'valid', 'passed', 'low'].includes(status)) return 'ready'
  return 'caution'
}

function signal(id, label, family, sourceStatus, sourceEvent, cadence = 'operator-review') {
  return {
    id,
    label,
    family,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    cadence,
    automatedPaging: false,
  }
}

function buildMonitoringSignalCatalog(input = {}) {
  const health = input.systemHealthCommandCenter ?? {}
  const observability = input.eventObservability ?? {}
  const security = input.productionSecurityReadiness ?? {}
  const deployment = input.productionDeploymentReadiness ?? {}
  const environment = input.productionEnvironmentConfiguration ?? {}
  const runbook = input.productionOperationsRunbook ?? {}
  const incident = input.productionIncidentResponse ?? {}
  const rollback = input.productionRollbackReadiness ?? {}
  const operatorActions = input.operatorActionCenter ?? {}
  const audit = input.enterpriseAuditTrail ?? {}
  const release = input.enterpriseReleaseControl ?? {}

  return [
    signal('platform-health', 'Platform health status', 'health', health.finalPlatformHealthStatus, health.eventType),
    signal('module-registry', 'Module health registry coverage', 'health', health.moduleHealthRegistry?.length > 0 ? 'ready' : 'caution', health.eventType),
    signal('event-observability', 'Event observability status', 'event-observability', observability.observabilityStatus, observability.eventType),
    signal('critical-event-health', 'Critical event health', 'event-observability', observability.criticalEventHealthStatus, observability.eventType),
    signal('security-readiness', 'Production security readiness', 'security', security.securityReadinessStatus, security.eventType),
    signal('paper-safety-lock', 'Paper-trading safety lock', 'security', security.paperTradingSafetyLockSummary?.status, security.eventType),
    signal('deployment-readiness', 'Deployment readiness status', 'deployment', deployment.deploymentReadinessStatus, deployment.eventType),
    signal('environment-configuration', 'Environment configuration status', 'deployment', environment.configurationReadinessStatus, environment.eventType),
    signal('operations-runbook', 'Operations runbook handoff status', 'deployment', runbook.operatorHandoffSummary?.handoffStatus, runbook.eventType),
    signal('incident-response', 'Incident response readiness', 'operator-action', incident.incidentReadinessStatus, incident.eventType),
    signal('rollback-readiness', 'Rollback readiness status', 'operator-action', rollback.rollbackReadinessStatus, rollback.eventType),
    signal('operator-actions', 'Operator action severity', 'operator-action', operatorActions.platformActionSummary?.topSeverity, operatorActions.eventType),
    signal('audit-integrity', 'Audit integrity status', 'event-observability', audit.auditIntegrityStatus?.status, audit.eventType),
    signal('release-control', 'Enterprise release control status', 'deployment', release.finalReleaseStatus, release.eventType),
  ]
}

function summarizeFamily(catalog, family) {
  const signals = catalog.filter((item) => item.family === family)
  const blocked = signals.filter((item) => item.status === 'blocked').length
  const caution = signals.filter((item) => item.status === 'caution').length
  return {
    family,
    signalCount: signals.length,
    blockedCount: blocked,
    cautionCount: caution,
    status: blocked > 0 ? 'blocked' : caution > 0 ? 'caution' : 'ready',
    sourceEvents: [...new Set(signals.map((item) => item.sourceEvent).filter(Boolean))],
  }
}

function resolveMonitoringReadinessStatus(summaries) {
  if (summaries.some((summary) => summary.status === 'blocked')) return 'blocked'
  if (summaries.some((summary) => summary.status === 'caution')) return 'caution'
  return 'ready'
}

export function generateProductionMonitoringPlan(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const monitoringSignalCatalog = buildMonitoringSignalCatalog(input)
  const healthMonitoringSummary = summarizeFamily(monitoringSignalCatalog, 'health')
  const eventObservabilityMonitoringSummary = summarizeFamily(monitoringSignalCatalog, 'event-observability')
  const securityMonitoringSummary = summarizeFamily(monitoringSignalCatalog, 'security')
  const deploymentMonitoringSummary = summarizeFamily(monitoringSignalCatalog, 'deployment')
  const operatorActionMonitoringSummary = summarizeFamily(monitoringSignalCatalog, 'operator-action')
  const summaries = [
    healthMonitoringSummary,
    eventObservabilityMonitoringSummary,
    securityMonitoringSummary,
    deploymentMonitoringSummary,
    operatorActionMonitoringSummary,
  ]
  const monitoringReadinessStatus = resolveMonitoringReadinessStatus(summaries)
  const result = {
    eventType: SYSTEM_MONITORING_PLAN_GENERATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentTriggered: false,
    secretsIncluded: false,
    monitoringSignalCatalog,
    healthMonitoringSummary,
    eventObservabilityMonitoringSummary,
    securityMonitoringSummary,
    deploymentMonitoringSummary,
    operatorActionMonitoringSummary,
    monitoringReadinessStatus,
    summary: `Production monitoring plan ${monitoringReadinessStatus}: ${monitoringSignalCatalog.length} signals across health, observability, security, deployment, and operator action families.`,
    sourceEvents: {
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      productionEnvironmentConfiguration: input.productionEnvironmentConfiguration?.eventType ?? null,
      productionOperationsRunbook: input.productionOperationsRunbook?.eventType ?? null,
      productionIncidentResponse: input.productionIncidentResponse?.eventType ?? null,
      productionRollbackReadiness: input.productionRollbackReadiness?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      operatorActionCenter: input.operatorActionCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_MONITORING_PLAN_GENERATED_EVENT, result)
  }
  return result
}

export function createProductionMonitoringPlanEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return generateProductionMonitoringPlan(input, { ...options, ...evaluationOptions })
    },
  }
}
