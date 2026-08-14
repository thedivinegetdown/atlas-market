import { createHash } from 'node:crypto'
import pg from 'pg'

const DEFAULT_POOL_MAX = 5
const MAX_POOL_MAX = 10
const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000
const DEFAULT_QUERY_TIMEOUT_MS = 15_000

let sharedPoolRecord = null

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function missingDatabaseConfigurationError() {
  const error = new Error('Production database configuration is unavailable.')
  error.code = 'database_configuration_missing'
  return error
}

function resolveSsl({ env, production }) {
  const mode = String(env.DATABASE_SSL_MODE ?? (production ? 'verify-full' : 'prefer')).trim().toLowerCase()
  if (mode === 'disable') {
    if (production) {
      const error = new Error('Production database TLS cannot be disabled.')
      error.code = 'database_tls_required'
      throw error
    }
    return false
  }
  if (mode === 'require' || mode === 'verify-full') return { rejectUnauthorized: true }
  if (mode !== 'prefer') {
    const error = new Error('Database TLS mode is invalid.')
    error.code = 'database_tls_mode_invalid'
    throw error
  }
  return undefined
}

export function resolvePgConfiguration({
  connectionString,
  env = process.env,
  max,
  idleTimeoutMillis,
  connectionTimeoutMillis,
  queryTimeoutMillis,
} = {}) {
  const resolvedConnectionString = connectionString ?? env.DATABASE_URL
  const production = String(env.NODE_ENV ?? '').toLowerCase() === 'production'
  if (!resolvedConnectionString) {
    if (production) throw missingDatabaseConfigurationError()
    return null
  }

  return {
    connectionString: resolvedConnectionString,
    max: boundedInteger(max ?? env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX, { max: MAX_POOL_MAX }),
    idleTimeoutMillis: boundedInteger(idleTimeoutMillis ?? env.DATABASE_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
    connectionTimeoutMillis: boundedInteger(connectionTimeoutMillis ?? env.DATABASE_CONNECTION_TIMEOUT_MS, DEFAULT_CONNECTION_TIMEOUT_MS),
    query_timeout: boundedInteger(queryTimeoutMillis ?? env.DATABASE_QUERY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS),
    statement_timeout: boundedInteger(queryTimeoutMillis ?? env.DATABASE_QUERY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS),
    allowExitOnIdle: true,
    application_name: 'atlas-market-netlify',
    ssl: resolveSsl({ env, production }),
  }
}

function configurationKey(configuration) {
  return createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
}

export function createPgClient(options = {}) {
  const configuration = resolvePgConfiguration(options)
  if (!configuration) {
    return {
      connected: false,
      async query() {
        return { rows: [] }
      },
      async end() {},
    }
  }

  const client = new pg.Client(configuration)
  return {
    connected: true,
    client,
    async connect() {
      if (!this.client._connected) {
        await this.client.connect()
        this.client._connected = true
      }
    },
    async query(text, params = []) {
      await this.connect()
      return this.client.query(text, params)
    },
    async end() {
      await this.client.end()
    },
  }
}

export function createPgPoolClient({ poolFactory = (configuration) => new pg.Pool(configuration), ...options } = {}) {
  const configuration = resolvePgConfiguration(options)
  if (!configuration) {
    return {
      connected: false,
      pool: null,
      async query() {
        return { rows: [], rowCount: 0 }
      },
      async connect() {
        return {
          query: async () => ({ rows: [], rowCount: 0 }),
          release() {},
        }
      },
      async end() {},
    }
  }

  const key = configurationKey(configuration)
  if (sharedPoolRecord && sharedPoolRecord.key !== key) {
    const error = new Error('A PostgreSQL pool is already active with different configuration.')
    error.code = 'database_pool_configuration_conflict'
    throw error
  }
  if (!sharedPoolRecord) sharedPoolRecord = { key, pool: poolFactory(configuration) }
  const pool = sharedPoolRecord.pool

  return {
    connected: true,
    pool,
    async query(text, params = []) {
      return pool.query(text, params)
    },
    async connect() {
      return pool.connect()
    },
    // Netlify handlers release their repository per request. The process-level pool
    // remains available for warm invocations and is closed only by explicit shutdown.
    async end() {},
  }
}

export async function shutdownSharedPgPool() {
  const record = sharedPoolRecord
  sharedPoolRecord = null
  await record?.pool?.end?.()
}
