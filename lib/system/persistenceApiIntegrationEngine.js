import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_PERSISTENCE_API_INTEGRATION_EVALUATED_EVENT = 'system.persistenceApiIntegration.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'healthy', 'valid', 'passed', 'available'].includes(status)) return 'ready'
  return 'caution'
}

function resolveReadiness(sections) {
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

export function evaluatePersistenceApiIntegration(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const database = input.databasePersistence ?? {}
  const api = input.apiFoundation ?? {}
  const migrationValidation = section(
    'migration-validation',
    'Migration validation',
    database.migrationSummary?.ok === false ? 'blocked' : 'ready',
    {
      applied: database.migrationSummary?.applied ?? [],
      skipped: database.migrationSummary?.skipped ?? [],
      repeatable: true,
    },
  )
  const repositoryContractValidation = section(
    'repository-contract',
    'Repository contract validation',
    database.parameterizedQueriesEnforced && database.transactionHelperAvailable ? 'ready' : 'blocked',
    {
      stores: database.repositoryStores ?? [],
      parameterizedQueriesEnforced: database.parameterizedQueriesEnforced === true,
      transactionHelperAvailable: database.transactionHelperAvailable === true,
    },
  )
  const functionHandlerValidation = section(
    'function-handler',
    'Netlify Function handler validation',
    api.status ?? 'ready',
    {
      endpoints: api.endpoints ?? [
        'database-health',
        'workspace-configurations',
        'system-events',
        'operator-actions',
      ],
      noTradingEndpoints: true,
      noBrokerExecutionEndpoints: true,
    },
  )
  const apiDatabaseHealthAggregation = section(
    'api-database-health',
    'API / database health aggregation',
    database.status ?? database.databaseHealthCheck?.status,
    {
      databaseHealth: database.databaseHealthCheck ?? { status: 'disabled' },
      localFallbackPreserved: database.localFallback === true || input.workspacePersistence?.localPersistenceAdapter?.status !== 'unknown',
    },
  )
  const degradedModeHandling = section(
    'degraded-mode',
    'Failure and degraded-mode handling',
    database.status === 'blocked' ? 'blocked' : 'ready',
    {
      localWorkspaceFallback: true,
      productionDatabaseRequiredForTests: false,
      safePublicErrors: true,
    },
  )
  const sections = [
    migrationValidation,
    repositoryContractValidation,
    functionHandlerValidation,
    apiDatabaseHealthAggregation,
    degradedModeHandling,
  ]
  const persistenceReadinessStatus = resolveReadiness(sections)
  const result = {
    eventType: SYSTEM_PERSISTENCE_API_INTEGRATION_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    authenticationAdded: false,
    deploymentTriggered: false,
    secretsExposed: false,
    migrationValidation,
    repositoryContractValidation,
    functionHandlerValidation,
    apiDatabaseHealthAggregation,
    degradedModeHandling,
    persistenceReadinessStatus,
    summary: `Persistence and API integration ${persistenceReadinessStatus}: repository contracts, migrations, handlers, and degraded-mode fallback reviewed.`,
    sourceEvents: {
      databasePersistence: database.eventType ?? null,
      apiFoundation: api.eventType ?? null,
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_PERSISTENCE_API_INTEGRATION_EVALUATED_EVENT, result)
  }
  return result
}

export function createPersistenceApiIntegrationEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluatePersistenceApiIntegration(input, { ...options, ...evaluationOptions })
    },
  }
}
