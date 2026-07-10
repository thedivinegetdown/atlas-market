import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_DATABASE_OPERATIONS_EVALUATED_EVENT,
  createDatabaseOperationsEngine,
  evaluateDatabaseOperations,
} from './databaseOperationsEngine.js'

const readyDatabasePersistence = {
  eventType: 'system.databasePersistence.initialized',
  status: 'ready',
  connected: true,
  localFallback: false,
  databaseHealthCheck: { status: 'healthy', connected: true, localFallback: false },
  migrationSummary: {
    ok: true,
    applied: ['202607090001_phase26_persistence_foundation'],
    skipped: [],
    repeatable: true,
  },
  repositoryStores: [
    'workspaceConfigurations',
    'workspaceSessions',
    'systemEvents',
    'enterpriseAuditRecords',
    'operatorActions',
  ],
  transactionHelperAvailable: true,
}

describe('database operations engine', () => {
  it('evaluates ready database operations from persistence foundation output', () => {
    const result = evaluateDatabaseOperations({
      databasePersistence: readyDatabasePersistence,
      persistenceApiIntegration: { eventType: 'system.persistenceApiIntegration.evaluated' },
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_DATABASE_OPERATIONS_EVALUATED_EVENT)
    expect(result.databaseOperationsStatus).toBe('ready')
    expect(result.migrationExecutionCoordinator.executionMode).toBe('postgres-repository')
    expect(result.migrationStatusReporting.appliedCount).toBe(1)
    expect(result.schemaVersionSummary.currentVersion).toBe('202607090001_phase26_persistence_foundation')
    expect(result.connectionTimeoutAndRetryPolicy.retryPolicy.maxAttempts).toBe(2)
    expect(result.transactionRollbackVerification.rollbackVerifiedByContractTests).toBe(true)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.liveProductionMigrationExecution).toBe(false)
    expect(result.credentialsExposed).toBe(false)
  })

  it('keeps local/test-safe disabled database state in caution without blocking fallback', () => {
    const result = evaluateDatabaseOperations({
      databasePersistence: {
        ...readyDatabasePersistence,
        status: 'caution',
        connected: false,
        localFallback: true,
        databaseHealthCheck: { status: 'disabled', connected: false, localFallback: true },
        migrationSummary: {
          ok: true,
          applied: [],
          skipped: ['202607090001_phase26_persistence_foundation'],
          repeatable: true,
        },
      },
    }, { emitEvent: false })

    expect(result.databaseOperationsStatus).toBe('caution')
    expect(result.migrationExecutionCoordinator.executionMode).toBe('local-test-safe-disabled')
    expect(result.databaseStartupReadinessCheck.localFallbackPreserved).toBe(true)
    expect(result.repositoryDegradedModeSummary.localWorkspaceFallback).toBe(true)
  })

  it('blocks when transaction rollback support is unavailable', () => {
    const result = evaluateDatabaseOperations({
      databasePersistence: {
        ...readyDatabasePersistence,
        transactionHelperAvailable: false,
      },
    }, { emitEvent: false })

    expect(result.databaseOperationsStatus).toBe('blocked')
    expect(result.transactionRollbackVerification.status).toBe('blocked')
  })

  it('emits database operations events through the engine factory', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_DATABASE_OPERATIONS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createDatabaseOperationsEngine({ eventBus }).evaluate({
      databasePersistence: readyDatabasePersistence,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
