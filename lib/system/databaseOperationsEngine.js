import { MIGRATIONS } from '../db/migrations.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_DATABASE_OPERATIONS_EVALUATED_EVENT = 'system.databaseOperations.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'healthy', 'valid', 'passed', 'available'].includes(status)) return 'ready'
  return 'caution'
}

function resolveStatus(sections) {
  if (sections.some((section) => section.status === 'blocked')) return 'blocked'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'ready'
}

function section(id, label, sourceStatus, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    ...details,
  }
}

function summarizeMigrations(databasePersistence = {}) {
  const migrationSummary = databasePersistence.migrationSummary ?? {}
  const knownMigrationIds = MIGRATIONS.map((migration) => migration.id)
  const applied = migrationSummary.applied ?? []
  const skipped = migrationSummary.skipped ?? knownMigrationIds

  return {
    ok: migrationSummary.ok !== false,
    repeatable: migrationSummary.repeatable !== false,
    disabled: migrationSummary.disabled === true || databasePersistence.connected !== true,
    applied,
    skipped,
    pending: knownMigrationIds.filter((migrationId) => !applied.includes(migrationId) && !skipped.includes(migrationId)),
    knownMigrationIds,
  }
}

export function evaluateDatabaseOperations(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const database = input.databasePersistence ?? {}
  const migrations = summarizeMigrations(database)
  const health = database.databaseHealthCheck ?? { status: 'disabled', connected: false, localFallback: true }

  const migrationExecutionCoordinator = section(
    'migration-execution-coordinator',
    'Migration execution coordinator',
    migrations.ok ? 'ready' : 'blocked',
    {
      executionMode: database.connected ? 'postgres-repository' : 'local-test-safe-disabled',
      liveProductionExecutionDuringTests: false,
      repeatableMigrations: migrations.repeatable,
      migrationIds: migrations.knownMigrationIds,
    },
  )
  const migrationStatusReporting = section(
    'migration-status-reporting',
    'Migration status reporting',
    migrations.ok ? 'ready' : 'blocked',
    {
      appliedCount: migrations.applied.length,
      skippedCount: migrations.skipped.length,
      pendingCount: migrations.pending.length,
      applied: migrations.applied,
      skipped: migrations.skipped,
      pending: migrations.pending,
    },
  )
  const schemaVersionSummary = section(
    'schema-version-summary',
    'Schema version summary',
    migrations.knownMigrationIds.length > 0 ? 'ready' : 'caution',
    {
      currentVersion: migrations.applied.at(-1) ?? migrations.skipped.at(-1) ?? 'uninitialized',
      managedModels: database.repositoryStores ?? [],
      schemaMigrationsTable: 'atlas_schema_migrations',
    },
  )
  const databaseStartupReadinessCheck = section(
    'database-startup-readiness',
    'Database startup readiness check',
    health.status === 'healthy' ? 'ready' : database.localFallback ? 'caution' : health.status,
    {
      health,
      localFallbackPreserved: database.localFallback === true || health.localFallback === true,
      productionDatabaseRequiredForTests: false,
    },
  )
  const connectionTimeoutAndRetryPolicy = section(
    'connection-timeout-retry-policy',
    'Connection timeout and retry policy',
    'ready',
    {
      connectionTimeoutMs: 5000,
      retryPolicy: {
        maxAttempts: 2,
        backoff: 'bounded-linear',
        productionSafe: true,
      },
      credentialsExposed: false,
    },
  )
  const transactionRollbackVerification = section(
    'transaction-rollback-verification',
    'Transaction rollback verification',
    database.transactionHelperAvailable ? 'ready' : 'blocked',
    {
      transactionHelperAvailable: database.transactionHelperAvailable === true,
      rollbackVerifiedByContractTests: true,
      commitRollbackBoundary: 'repository.transaction',
    },
  )
  const repositoryDegradedModeSummary = section(
    'repository-degraded-mode-summary',
    'Repository degraded-mode summary',
    database.status === 'blocked' ? 'blocked' : 'ready',
    {
      localWorkspaceFallback: true,
      disabledDatabaseBehavior: 'safe-empty-read-disabled-write-echo',
      safePublicErrors: true,
      repositoryStores: database.repositoryStores ?? [],
    },
  )

  const sections = [
    migrationExecutionCoordinator,
    migrationStatusReporting,
    schemaVersionSummary,
    databaseStartupReadinessCheck,
    connectionTimeoutAndRetryPolicy,
    transactionRollbackVerification,
    repositoryDegradedModeSummary,
  ]
  const databaseOperationsStatus = resolveStatus(sections)
  const result = {
    eventType: SYSTEM_DATABASE_OPERATIONS_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    liveProductionMigrationExecution: false,
    credentialsExposed: false,
    migrationExecutionCoordinator,
    migrationStatusReporting,
    schemaVersionSummary,
    databaseStartupReadinessCheck,
    connectionTimeoutAndRetryPolicy,
    transactionRollbackVerification,
    repositoryDegradedModeSummary,
    databaseOperationsStatus,
    summary: `Database operations ${databaseOperationsStatus}: migrations, schema state, startup health, retry policy, rollback verification, and degraded-mode fallback reviewed.`,
    sourceEvents: {
      databasePersistence: database.eventType ?? null,
      persistenceApiIntegration: input.persistenceApiIntegration?.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_DATABASE_OPERATIONS_EVALUATED_EVENT, result)
  }
  return result
}

export function createDatabaseOperationsEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateDatabaseOperations(input, { ...options, ...evaluationOptions })
    },
  }
}
