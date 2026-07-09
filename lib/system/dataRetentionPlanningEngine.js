import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_DATA_RETENTION_PLANNED_EVENT = 'system.dataRetention.planned'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeReadiness(status) {
  if (['blocked', 'invalid', 'degraded', 'failed'].includes(status)) return 'blocked'
  if (['ready', 'valid', 'healthy', 'operational', 'release-ready', 'passed'].includes(status)) return 'ready'
  return 'caution'
}

function retentionPlan(id, label, sourceStatus, sourceEvent, retentionWindow, storageTarget = 'local-planning') {
  return {
    id,
    label,
    status: normalizeReadiness(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    retentionWindow,
    storageTarget,
    deletionScheduled: false,
    userDataMutated: false,
  }
}

function buildFuturePostgresRetentionPlaceholder(input = {}) {
  const postgres = input.workspacePersistence?.futurePostgresPersistenceInterface ?? {}
  return {
    status: postgres.implemented ? 'ready' : 'caution',
    implemented: postgres.implemented === true,
    migrationAdded: false,
    retentionTablesPlanned: [
      'system_events',
      'audit_records',
      'workspace_snapshots',
      'backtest_reports',
      'research_contexts',
    ],
    sourceEvent: input.workspacePersistence?.eventType ?? null,
  }
}

function resolveRetentionReadinessStatus(plans, futurePostgresRetentionPlaceholder) {
  if (plans.some((plan) => plan.status === 'blocked')) return 'blocked'
  if (plans.some((plan) => plan.status === 'caution') || futurePostgresRetentionPlaceholder.status === 'caution') return 'caution'
  return 'ready'
}

export function planDataRetention(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const eventRetentionPlanning = retentionPlan(
    'event-retention',
    'Event retention planning',
    input.eventObservability?.observabilityStatus,
    input.eventObservability?.eventType,
    '90 days active / 1 year archive planning',
    'future-postgresql-events',
  )
  const auditRetentionPlanning = retentionPlan(
    'audit-retention',
    'Audit retention planning',
    input.enterpriseAuditTrail?.auditIntegrityStatus?.status,
    input.enterpriseAuditTrail?.eventType,
    '1 year active / 7 years archive planning',
    'future-postgresql-audit',
  )
  const workspaceRetentionPlanning = retentionPlan(
    'workspace-retention',
    'Workspace retention planning',
    input.workspacePersistence?.persistenceStatus,
    input.workspacePersistence?.eventType,
    'latest local snapshot plus future versioned snapshots',
    'local-adapter-now-postgresql-later',
  )
  const backtestRetentionPlanning = retentionPlan(
    'backtest-retention',
    'Backtest retention planning',
    input.strategyBacktestReport?.releaseResearchRecommendation ? 'ready' : 'caution',
    input.strategyBacktestReport?.eventType,
    'strategy research reports retained by version',
    'future-postgresql-research',
  )
  const researchRetentionPlanning = retentionPlan(
    'research-retention',
    'Research retention planning',
    input.researchDecisionContext?.eventType && input.marketIntelligence?.eventType ? 'ready' : 'caution',
    input.researchDecisionContext?.eventType ?? input.marketIntelligence?.eventType,
    'decision context retained with mock/provenance labels',
    'future-postgresql-research',
  )
  const futurePostgresRetentionPlaceholder = buildFuturePostgresRetentionPlaceholder(input)
  const plans = [
    eventRetentionPlanning,
    auditRetentionPlanning,
    workspaceRetentionPlanning,
    backtestRetentionPlanning,
    researchRetentionPlanning,
  ]
  const retentionReadinessStatus = resolveRetentionReadinessStatus(plans, futurePostgresRetentionPlaceholder)
  const result = {
    eventType: SYSTEM_DATA_RETENTION_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    databaseMigrationAdded: false,
    userDataDeleted: false,
    userDataMutated: false,
    eventRetentionPlanning,
    auditRetentionPlanning,
    workspaceRetentionPlanning,
    backtestRetentionPlanning,
    researchRetentionPlanning,
    futurePostgresRetentionPlaceholder,
    retentionReadinessStatus,
    summary: `Data retention planning ${retentionReadinessStatus}: ${plans.length} retention domains mapped with no deletions, no migrations, and no data mutation.`,
    sourceEvents: {
      eventObservability: input.eventObservability?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      strategyBacktestReport: input.strategyBacktestReport?.eventType ?? null,
      researchDecisionContext: input.researchDecisionContext?.eventType ?? null,
      dataQualityReadiness: input.dataQualityReadiness?.eventType ?? null,
      dataLineage: input.dataLineage?.eventType ?? null,
      productionDeploymentReadiness: input.productionDeploymentReadiness?.eventType ?? null,
      productionSecurityReadiness: input.productionSecurityReadiness?.eventType ?? null,
      productionMonitoringPlan: input.productionMonitoringPlan?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_DATA_RETENTION_PLANNED_EVENT, result)
  }
  return result
}

export function createDataRetentionPlanningEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return planDataRetention(input, { ...options, ...evaluationOptions })
    },
  }
}
