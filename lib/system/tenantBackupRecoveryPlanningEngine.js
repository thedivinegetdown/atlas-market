import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_TENANT_BACKUP_RECOVERY_PLANNED_EVENT = 'system.tenantBackupRecovery.planned'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function readiness(status) {
  if (['blocked', 'invalid', 'degraded', 'failed'].includes(status)) return 'blocked'
  if (['ready', 'healthy', 'valid', 'operational'].includes(status)) return 'ready'
  return 'caution'
}

function backupScope(id, label, sourceStatus, sourceEvent) {
  return {
    id,
    label,
    status: readiness(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    sourceEvent,
    backupPlanned: true,
    realBackupPerformed: false,
    restorePerformed: false,
  }
}

function aggregateStatus(scopes) {
  if (scopes.some((scope) => scope.status === 'blocked')) return 'blocked'
  if (scopes.some((scope) => scope.status === 'caution')) return 'caution'
  return 'ready'
}

export function planTenantBackupRecovery(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantIsolation = input.tenantIsolation ?? {}
  const dataRetention = input.dataRetention ?? input.dataRetentionPlanning ?? {}
  const dataLineage = input.dataLineage ?? {}
  const persistence = input.persistenceApiIntegration ?? input.workspacePersistence ?? {}
  const runbook = input.productionOperationsRunbook ?? {}
  const workspaceConfigurationBackupScope = backupScope('workspace-configuration-backup', 'Workspace configuration backup scope', persistence.persistenceReadinessStatus ?? persistence.persistenceStatus, persistence.eventType)
  const systemEventBackupScope = backupScope('system-event-backup', 'System event backup scope', input.eventObservability?.observabilityStatus, input.eventObservability?.eventType)
  const operatorActionBackupScope = backupScope('operator-action-backup', 'Operator action backup scope', input.operatorActions?.eventType ? 'ready' : 'caution', input.operatorActions?.eventType)
  const administrativeAuditBackupScope = backupScope('administrative-audit-backup', 'Administrative audit backup scope', input.administrativeAudit?.status ?? input.enterpriseAuditTrail?.auditIntegrityStatus?.status, input.administrativeAudit?.eventType ?? input.enterpriseAuditTrail?.eventType)
  const organizationTeamMetadataBackupScope = backupScope('organization-team-metadata-backup', 'Organization/team metadata backup scope', tenantIsolation.tenantIsolationStatus, tenantIsolation.eventType)
  const scopes = [
    workspaceConfigurationBackupScope,
    systemEventBackupScope,
    operatorActionBackupScope,
    administrativeAuditBackupScope,
    organizationTeamMetadataBackupScope,
  ]
  const backupReadinessStatus = aggregateStatus(scopes)
  const recoveryOrderingPlan = [
    'tenant organization metadata',
    'team workspace metadata',
    'workspace configurations',
    'system events',
    'operator actions',
    'administrative audit records',
  ]
  const recoveryDependencySummary = {
    retentionStatus: dataRetention.retentionReadinessStatus ?? 'unknown',
    lineageStatus: dataLineage.lineageStatus ?? 'unknown',
    persistenceStatus: persistence.persistenceReadinessStatus ?? persistence.persistenceStatus ?? 'unknown',
    runbookStatus: runbook.operatorHandoffSummary?.handoffStatus ?? 'unknown',
    databaseDumpCreated: false,
    credentialsIncluded: false,
    localFallbackPreserved: true,
  }
  const recoveryReadinessStatus = aggregateStatus([
    ...scopes,
    { status: readiness(recoveryDependencySummary.retentionStatus) },
    { status: readiness(recoveryDependencySummary.lineageStatus === 'valid' ? 'ready' : recoveryDependencySummary.lineageStatus) },
    { status: readiness(recoveryDependencySummary.runbookStatus) },
  ])
  const result = {
    eventType: SYSTEM_TENANT_BACKUP_RECOVERY_PLANNED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    planningOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    realBackupPerformed: false,
    restorePerformed: false,
    dataMutated: false,
    databaseDumpCreated: false,
    credentialsIncluded: false,
    workspaceConfigurationBackupScope,
    systemEventBackupScope,
    operatorActionBackupScope,
    administrativeAuditBackupScope,
    organizationTeamMetadataBackupScope,
    recoveryOrderingPlan,
    recoveryDependencySummary,
    backupReadinessStatus,
    recoveryReadinessStatus,
    summary: `Tenant backup and recovery planning ${backupReadinessStatus}/${recoveryReadinessStatus}: ${scopes.length} backup scopes mapped with no backup, restore, dump, credential, or data mutation.`,
    sourceEvents: {
      dataRetention: dataRetention.eventType ?? null,
      dataLineage: dataLineage.eventType ?? null,
      persistence: persistence.eventType ?? null,
      tenantIsolation: tenantIsolation.eventType ?? null,
      operationsRunbook: runbook.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_TENANT_BACKUP_RECOVERY_PLANNED_EVENT, result)
  return result
}
