import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INCIDENT_RESPONSE_PLANNED_EVENT = 'system.incidentResponse.planned'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeReadiness(status) {
  if (['blocked', 'degraded', 'invalid', 'failed', 'critical', 'high'].includes(status)) return 'blocked'
  if (['ready', 'healthy', 'operational', 'valid', 'release-ready', 'passed', 'low'].includes(status)) return 'ready'
  return 'caution'
}

function incidentCategory(id, label, sourceStatus, severity, detectionSources) {
  return {
    id,
    label,
    sourceStatus: sourceStatus ?? 'unknown',
    readinessStatus: normalizeReadiness(sourceStatus),
    severity,
    detectionSources: detectionSources.filter(Boolean),
  }
}

function responseStep(id, label, categoryId, owner, source, status = 'ready') {
  return {
    id,
    label,
    categoryId,
    owner,
    source,
    status: normalizeReadiness(status),
    executable: false,
  }
}

function buildIncidentCategoryModel(input = {}) {
  const deployment = input.productionDeploymentReadiness ?? {}
  const security = input.productionSecurityReadiness ?? {}
  const environment = input.productionEnvironmentConfiguration ?? {}
  const runbook = input.productionOperationsRunbook ?? {}
  const release = input.enterpriseReleaseControl ?? {}
  const audit = input.enterpriseAuditTrail ?? {}
  const observability = input.eventObservability ?? {}
  const health = input.systemHealthCommandCenter ?? {}
  const operatorActions = input.operatorActionCenter ?? {}

  return [
    incidentCategory('platform-health', 'Platform health degradation', health.finalPlatformHealthStatus, 'high', [health.eventType, observability.eventType]),
    incidentCategory('security-boundary', 'Security or paper-mode boundary concern', security.securityReadinessStatus, 'critical', [security.eventType, release.eventType]),
    incidentCategory('deployment-readiness', 'Future deployment readiness issue', deployment.deploymentReadinessStatus, 'medium', [deployment.eventType, runbook.eventType]),
    incidentCategory('environment-configuration', 'Environment configuration drift', environment.configurationReadinessStatus, 'medium', [environment.eventType, security.eventType]),
    incidentCategory('operator-action', 'Open operator action backlog', operatorActions.platformActionSummary?.topSeverity, operatorActions.platformActionSummary?.topSeverity ?? 'medium', [operatorActions.eventType]),
    incidentCategory('audit-traceability', 'Audit traceability issue', audit.auditIntegrityStatus?.status, 'high', [audit.eventType, observability.eventType]),
  ]
}

function buildOperatorResponseSteps(categories, input = {}) {
  const runbook = input.productionOperationsRunbook ?? {}
  const categoryStatus = (id) => categories.find((category) => category.id === id)?.readinessStatus
  return [
    responseStep('capture-health-snapshot', 'Capture current system health and affected module summaries.', 'platform-health', 'operator', input.systemHealthCommandCenter?.eventType, categoryStatus('platform-health')),
    responseStep('preserve-event-chain', 'Preserve observability and audit event references for review.', 'audit-traceability', 'operator', input.enterpriseAuditTrail?.eventType, categoryStatus('audit-traceability')),
    responseStep('confirm-paper-lock', 'Confirm paper-trading safety remains locked and live orders remain disabled.', 'security-boundary', 'operator', input.productionSecurityReadiness?.eventType, categoryStatus('security-boundary')),
    responseStep('review-runbook', 'Use the non-executable operations runbook checklist as the incident guide.', 'deployment-readiness', 'operator', runbook.eventType, runbook.operatorHandoffSummary?.handoffStatus),
    responseStep('triage-open-actions', 'Triage high-severity operator actions before any release review.', 'operator-action', 'operator', input.operatorActionCenter?.eventType, categoryStatus('operator-action')),
  ]
}

function buildEscalationPlanning(categories, responseSteps) {
  const blockedCategories = categories.filter((category) => category.readinessStatus === 'blocked')
  const cautionCategories = categories.filter((category) => category.readinessStatus === 'caution')
  return {
    escalationRequired: blockedCategories.length > 0 || categories.some((category) => category.severity === 'critical' && category.readinessStatus !== 'ready'),
    primaryEscalationPath: blockedCategories.length > 0 ? 'engineering-lead-and-operator' : 'operator-review',
    blockedCategoryIds: blockedCategories.map((category) => category.id),
    cautionCategoryIds: cautionCategories.map((category) => category.id),
    responseStepCount: responseSteps.length,
    liveBrokerEscalation: false,
  }
}

function buildRollbackRecommendationSummary(input, categories) {
  const releaseStatus = input.enterpriseReleaseControl?.finalReleaseStatus ?? 'unknown'
  const runbookStatus = input.productionOperationsRunbook?.operatorHandoffSummary?.handoffStatus ?? 'unknown'
  const shouldPrepareRollback = categories.some((category) => category.readinessStatus === 'blocked')
    || releaseStatus === 'blocked'
    || runbookStatus === 'blocked'
  return {
    recommendation: shouldPrepareRollback ? 'prepare-rollback-review' : 'monitor',
    rationale: shouldPrepareRollback
      ? 'Blocked planning inputs require rollback readiness review before future production action.'
      : 'No blocking incident category is present; continue monitoring through paper-mode operations.',
    rollbackExecuted: false,
    deploymentChanged: false,
  }
}

function resolveIncidentReadinessStatus(categories, escalationPlanning) {
  if (categories.some((category) => category.readinessStatus === 'blocked')) return 'blocked'
  if (escalationPlanning.escalationRequired || categories.some((category) => category.readinessStatus === 'caution')) return 'caution'
  return 'ready'
}

export function planProductionIncidentResponse(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const incidentCategoryModel = buildIncidentCategoryModel(input)
  const operatorResponseSteps = buildOperatorResponseSteps(incidentCategoryModel, input)
  const escalationPlanning = buildEscalationPlanning(incidentCategoryModel, operatorResponseSteps)
  const rollbackRecommendationSummary = buildRollbackRecommendationSummary(input, incidentCategoryModel)
  const incidentReadinessStatus = resolveIncidentReadinessStatus(incidentCategoryModel, escalationPlanning)
  const severityModel = {
    critical: incidentCategoryModel.filter((category) => category.severity === 'critical').length,
    high: incidentCategoryModel.filter((category) => category.severity === 'high').length,
    medium: incidentCategoryModel.filter((category) => category.severity === 'medium').length,
    low: incidentCategoryModel.filter((category) => category.severity === 'low').length,
  }
  const result = {
    eventType: SYSTEM_INCIDENT_RESPONSE_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentTriggered: false,
    secretsIncluded: false,
    incidentCategoryModel,
    severityModel,
    detectionSourceReferences: [...new Set(incidentCategoryModel.flatMap((category) => category.detectionSources))],
    operatorResponseSteps,
    escalationPlanning,
    rollbackRecommendationSummary,
    incidentReadinessStatus,
    summary: `Incident response planning ${incidentReadinessStatus}: ${operatorResponseSteps.length} non-executable operator steps across ${incidentCategoryModel.length} incident categories.`,
    sourceEvents: {
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      productionEnvironmentConfiguration: input.productionEnvironmentConfiguration?.eventType ?? null,
      productionOperationsRunbook: input.productionOperationsRunbook?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
      operatorActionCenter: input.operatorActionCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_INCIDENT_RESPONSE_PLANNED_EVENT, result)
  }
  return result
}

export function createProductionIncidentResponsePlanner(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return planProductionIncidentResponse(input, { ...options, ...evaluationOptions })
    },
  }
}
