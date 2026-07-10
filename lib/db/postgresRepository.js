import { createPgPoolClient } from './pgClient.js'
import { runMigrations } from './migrations.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const DATABASE_PERSISTENCE_INITIALIZED_EVENT = 'system.databasePersistence.initialized'

const STORE_TABLES = Object.freeze({
  workspaceConfigurations: 'atlas_workspace_configurations',
  workspaceSessions: 'atlas_workspace_sessions',
  systemEvents: 'atlas_system_events',
  enterpriseAuditRecords: 'atlas_enterprise_audit_records',
  operatorActions: 'atlas_operator_actions',
})

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function assertParameterized(text, params) {
  const normalized = String(text ?? '')
  const placeholders = normalized.match(/\$\d+/g) ?? []
  if (placeholders.length > 0 && (!Array.isArray(params) || params.length === 0)) {
    throw new Error('Parameterized query requires a params array.')
  }
  if (params !== undefined && !Array.isArray(params)) {
    throw new Error('Query params must be an array.')
  }
}

export function normalizePersistenceError(error, fallbackCode = 'database_operation_failed') {
  return {
    ok: false,
    error: {
      code: error?.code && typeof error.code === 'string' ? error.code : fallbackCode,
      message: 'database operation failed',
      internalMessage: error?.message ?? 'database operation failed',
    },
  }
}

export function createDatabaseAdapter({ client } = {}) {
  const databaseClient = client ?? createPgPoolClient()
  return {
    connected: databaseClient.connected === true,
    async query(text, params = []) {
      assertParameterized(text, params)
      return databaseClient.query(text, params)
    },
    async transaction(callback) {
      if (!databaseClient.connected) {
        return callback({
          query: async () => ({ rows: [], rowCount: 0 }),
        })
      }

      const connection = await databaseClient.connect()
      try {
        await connection.query('BEGIN')
        const result = await callback(connection)
        await connection.query('COMMIT')
        return result
      } catch (error) {
        await connection.query('ROLLBACK')
        throw error
      } finally {
        connection.release()
      }
    },
    async healthCheck() {
      if (!databaseClient.connected) {
        return { status: 'disabled', connected: false, localFallback: true }
      }
      const result = await databaseClient.query('SELECT 1 AS ok', [])
      return { status: 'healthy', connected: true, rows: result.rows?.length ?? 0, localFallback: false }
    },
    async end() {
      await databaseClient.end?.()
    },
  }
}

function createStore(database, storeName) {
  const tableName = STORE_TABLES[storeName]
  if (!tableName) throw new Error(`Unsupported persistence store: ${storeName}`)

  return {
    storeName,
    tableName,
    async upsert(id, payload) {
      if (!database.connected) return { ok: true, disabled: true, data: { id, payload } }
      const result = await database.query(
        `INSERT INTO ${tableName} (id, payload, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING id, payload`,
        [id, payload],
      )
      return { ok: true, data: result.rows?.[0] ?? { id, payload } }
    },
    async list({ limit = 50 } = {}) {
      if (!database.connected) return []
      const result = await database.query(`SELECT id, payload FROM ${tableName} ORDER BY updated_at DESC LIMIT $1`, [limit])
      return result.rows ?? []
    },
    async get(id) {
      if (!database.connected) return null
      const result = await database.query(`SELECT id, payload FROM ${tableName} WHERE id = $1`, [id])
      return result.rows?.[0] ?? null
    },
  }
}

export function createPostgresRepository({ database } = {}) {
  const adapter = database ?? createDatabaseAdapter()
  const stores = Object.fromEntries(Object.keys(STORE_TABLES).map((storeName) => [
    storeName,
    createStore(adapter, storeName),
  ]))

  return {
    connected: adapter.connected,
    stores,
    async initialize() {
      try {
        const migration = await runMigrations(adapter)
        const health = await adapter.healthCheck()
        return { ok: true, migration, health }
      } catch (error) {
        return normalizePersistenceError(error, 'database_initialization_failed')
      }
    },
    async healthCheck() {
      try {
        return await adapter.healthCheck()
      } catch (error) {
        return { status: 'degraded', connected: false, error: normalizePersistenceError(error).error }
      }
    },
    async transaction(callback) {
      return adapter.transaction(callback)
    },
    getStore(name) {
      return stores[name] ?? null
    },
    async end() {
      await adapter.end?.()
    },
  }
}

export async function initializeDatabasePersistence(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const repository = options.repository ?? createPostgresRepository({
    database: options.database,
  })
  const initialization = await repository.initialize()
  const health = initialization.health ?? await repository.healthCheck()
  const result = {
    eventType: DATABASE_PERSISTENCE_INITIALIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    credentialsCommitted: false,
    connected: health.connected === true,
    localFallback: health.localFallback === true || initialization.migration?.disabled === true,
    databaseHealthCheck: health,
    migrationSummary: initialization.migration ?? { ok: false, applied: [], skipped: [] },
    repositoryStores: Object.keys(STORE_TABLES),
    parameterizedQueriesEnforced: true,
    transactionHelperAvailable: typeof repository.transaction === 'function',
    persistenceErrorNormalization: 'safe-public-error',
    status: initialization.ok === false ? 'blocked' : health.status === 'healthy' ? 'ready' : 'caution',
    summary: `Database persistence ${health.status ?? 'unknown'} with ${Object.keys(STORE_TABLES).length} repository stores and parameterized query enforcement.`,
    sourceEvents: {
      workspacePersistence: input.workspacePersistence?.eventType ?? null,
      enterpriseAuditTrail: input.enterpriseAuditTrail?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(DATABASE_PERSISTENCE_INITIALIZED_EVENT, result)
  }

  return result
}
