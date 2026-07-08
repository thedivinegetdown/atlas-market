import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_ROLLBACK_READINESS_EVALUATED_EVENT = 'system.rollbackReadiness.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'release-ready', 'healthy', 'operational', 'valid', 'passed'].includes(status)) return 'ready'
  return 'caution'
}

function checklistItem(id, label, sourceStatus, source, note) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    source,
    note,
    executable: false,
  }
}

function buildRollbackCriteriaSummary(input = {}) {
  const incident = input.productionIncidentResponse ?? {}
  const release = input.enterpriseReleaseControl ?? {}
  const health = input.systemHealthCommandCenter ?? {}
  const security = input.productionSecurityReadiness ?? {}
  const criteria = [
    checklistItem('incident-blocked', 'Blocked incident response category exists', incident.incidentReadinessStatus, incident.eventType, 'Prepare rollback review when incident planning is blocked.'),
    checklistItem('release-blocked', 'Release control blocks future release action', release.finalReleaseStatus, release.eventType, 'Do not proceed when enterprise release control is blocked.'),
    checklistItem('platform-degraded', 'Platform health is degraded', health.finalPlatformHealthStatus, health.eventType, 'Treat degraded health as rollback review input.'),
    checklistItem('paper-lock-risk', 'Paper-trading safety lock is unhealthy', security.paperTradingSafetyLockSummary?.status, security.eventType, 'Paper safety lock issues block release or rollback action.'),
  ]
  return {
    criteria,
    triggeredCriteria: criteria.filter((item) => item.status === 'blocked').map((item) => item.id),
    reviewCriteria: criteria.filter((item) => item.status === 'caution').map((item) => item.id),
    rollbackExecutionAuthorized: false,
  }
}

function buildDeploymentRollbackChecklist(input = {}) {
  const deployment = input.productionDeploymentReadiness ?? {}
  const runbook = input.productionOperationsRunbook ?? {}
  const incident = input.productionIncidentResponse ?? {}
  return [
    checklistItem('deployment-readiness-review', 'Review deployment readiness snapshot.', deployment.deploymentReadinessStatus, deployment.eventType, 'Planning only; no deployment rollback is performed.'),
    checklistItem('runbook-handoff-review', 'Review operations runbook handoff state.', runbook.operatorHandoffSummary?.handoffStatus, runbook.eventType, 'Use runbook references as operator guidance.'),
    checklistItem('incident-rollback-review', 'Review incident rollback recommendation.', incident.rollbackRecommendationSummary?.recommendation === 'prepare-rollback-review' ? 'caution' : incident.incidentReadinessStatus, incident.eventType, 'Prepare review materials without executing rollback.'),
  ]
}

function buildConfigurationRollbackChecklist(input = {}) {
  const environment = input.productionEnvironmentConfiguration ?? {}
  const security = input.productionSecurityReadiness ?? {}
  return [
    checklistItem('environment-descriptors', 'Compare environment variable descriptors.', environment.configurationReadinessStatus, environment.eventType, 'Never include secret values in rollback planning.'),
    checklistItem('security-secret-handling', 'Review managed secret-handling status.', security.environmentSecretHandlingSummary?.status, security.eventType, 'Confirm rollback notes contain names only, not values.'),
    checklistItem('api-boundary', 'Confirm API security boundary remains planned.', security.apiBoundarySecuritySummary?.status, security.eventType, 'Do not expose production APIs from rollback planning.'),
  ]
}

function buildRollbackBlockerSummary(sections) {
  const items = Object.values(sections).flatMap((section) => Array.isArray(section) ? section : section.criteria ?? [])
  const blockers = items.filter((item) => item.status === 'blocked')
  const cautions = items.filter((item) => item.status === 'caution')
  return {
    blockers: blockers.map((item) => item.id),
    cautions: cautions.map((item) => item.id),
    blockerCount: blockers.length,
    cautionCount: cautions.length,
    rollbackExecutable: false,
  }
}

function resolveRollbackReadinessStatus(blockerSummary) {
  if (blockerSummary.blockerCount > 0) return 'blocked'
  if (blockerSummary.cautionCount > 0) return 'caution'
  return 'ready'
}

export function evaluateProductionRollbackReadiness(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const rollbackCriteriaSummary = buildRollbackCriteriaSummary(input)
  const deploymentRollbackChecklist = buildDeploymentRollbackChecklist(input)
  const configurationRollbackChecklist = buildConfigurationRollbackChecklist(input)
  const dataSafetyRollbackNotes = {
    status: normalizeStatus(input.enterpriseAuditTrail?.auditIntegrityStatus?.status),
    notes: [
      'Preserve audit records and event-chain references before any future rollback procedure.',
      'Do not mutate paper portfolio accounting, journal, risk, strategy, or workspace state from this planner.',
    ],
    source: input.enterpriseAuditTrail?.eventType ?? null,
  }
  const paperTradingSafetyRollbackNotes = {
    status: normalizeStatus(input.productionSecurityReadiness?.paperTradingSafetyLockSummary?.status),
    notes: [
      'Rollback planning remains paper trading only.',
      'Live orders and broker execution are not authorized by this readiness engine.',
    ],
    source: input.productionSecurityReadiness?.eventType ?? null,
  }
  const rollbackBlockerSummary = buildRollbackBlockerSummary({
    rollbackCriteriaSummary,
    deploymentRollbackChecklist,
    configurationRollbackChecklist,
    dataSafetyRollbackNotes: [checklistItem('data-safety', 'Confirm audit/data safety notes.', dataSafetyRollbackNotes.status, dataSafetyRollbackNotes.source, dataSafetyRollbackNotes.notes[0])],
    paperTradingSafetyRollbackNotes: [checklistItem('paper-safety', 'Confirm paper-trading rollback notes.', paperTradingSafetyRollbackNotes.status, paperTradingSafetyRollbackNotes.source, paperTradingSafetyRollbackNotes.notes[0])],
  })
  const rollbackReadinessStatus = resolveRollbackReadinessStatus(rollbackBlockerSummary)
  const result = {
    eventType: SYSTEM_ROLLBACK_READINESS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    deploymentTriggered: false,
    secretsIncluded: false,
    rollbackCriteriaSummary,
    deploymentRollbackChecklist,
    configurationRollbackChecklist,
    dataSafetyRollbackNotes,
    paperTradingSafetyRollbackNotes,
    rollbackBlockerSummary,
    rollbackReadinessStatus,
    summary: `Rollback readiness ${rollbackReadinessStatus}: ${rollbackBlockerSummary.blockerCount} blockers and ${rollbackBlockerSummary.cautionCount} cautions identified for paper-only operations planning.`,
    sourceEvents: {
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      productionEnvironmentConfiguration: input.productionEnvironmentConfiguration?.eventType ?? null,
      productionOperationsRunbook: input.productionOperationsRunbook?.eventType ?? null,
      productionIncidentResponse: input.productionIncidentResponse?.eventType ?? null,
      enterpriseReleaseControl: input.enterpriseReleaseControl?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      systemHealthCommandCenter: input.systemHealthCommandCenter?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_ROLLBACK_READINESS_EVALUATED_EVENT, result)
  }
  return result
}

export function createProductionRollbackReadinessEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateProductionRollbackReadiness(input, { ...options, ...evaluationOptions })
    },
  }
}
