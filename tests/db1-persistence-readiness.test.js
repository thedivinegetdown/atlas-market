import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAtlasAiRepository } from '../lib/ai/atlasAiGateway.js'
import { MIGRATIONS, buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  createPgPoolClient,
  resolvePgConfiguration,
  shutdownSharedPgPool,
} from '../lib/db/pgClient.js'
import {
  createDatabaseAdapter,
  createPostgresRepository,
  normalizePersistenceError,
} from '../lib/db/postgresRepository.js'

afterEach(async () => {
  await shutdownSharedPgPool()
})

describe('DB.1 production connection contract', () => {
  it('fails closed in production when DATABASE_URL is missing', () => {
    expect(() => resolvePgConfiguration({ env: { NODE_ENV: 'production' } })).toThrow('Production database configuration is unavailable.')
    expect(resolvePgConfiguration({ env: { NODE_ENV: 'test' } })).toBeNull()
  })

  it('does not expose connection secrets through persistence errors', () => {
    const secret = 'postgres://owner:never-print-this@db.example/atlas'
    const result = normalizePersistenceError(new Error(`connection refused: ${secret}`))

    expect(result).toEqual({ ok: false, error: { code: 'database_operation_failed', message: 'database operation failed' } })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('reuses one bounded serverless pool and closes it only on explicit shutdown', async () => {
    const end = vi.fn(async () => {})
    const pool = { query: vi.fn(), connect: vi.fn(), end }
    const poolFactory = vi.fn(() => pool)
    const env = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db.example/atlas', DATABASE_POOL_MAX: '99' }

    const first = createPgPoolClient({ env, poolFactory })
    const second = createPgPoolClient({ env, poolFactory })
    await first.end()

    expect(first.pool).toBe(pool)
    expect(second.pool).toBe(pool)
    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(poolFactory.mock.calls[0][0]).toMatchObject({
      max: 10,
      allowExitOnIdle: true,
      ssl: { rejectUnauthorized: true },
    })
    expect(end).not.toHaveBeenCalled()

    await shutdownSharedPgPool()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('applies deterministic connection and query timeouts', () => {
    const configuration = resolvePgConfiguration({
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db.example/atlas',
        DATABASE_CONNECTION_TIMEOUT_MS: '2500',
        DATABASE_QUERY_TIMEOUT_MS: '7000',
      },
    })

    expect(configuration.connectionTimeoutMillis).toBe(2500)
    expect(configuration.query_timeout).toBe(7000)
    expect(configuration.statement_timeout).toBe(7000)
  })
})

describe('DB.1 tenant isolation and transaction behavior', () => {
  it('adds organization, team, and user filters to scoped reads', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createPostgresRepository({
      database: { connected: true, query, transaction: vi.fn(), healthCheck: vi.fn(), end: vi.fn() },
    })

    await repository.getStore('operatorActions').listScoped({
      organizationId: 'org-a',
      teamWorkspaceId: 'team-a',
      userId: 'user-a',
      limit: 25,
    })

    expect(query.mock.calls[0][0]).toContain('organization_id = $1 AND team_workspace_id = $2 AND user_id = $3')
    expect(query.mock.calls[0][0]).toContain('LIMIT $4')
    expect(query.mock.calls[0][1]).toEqual(['org-a', 'team-a', 'user-a', 25])
  })

  it('denies a cross-organization overwrite when the record id is already owned', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createPostgresRepository({
      database: { connected: true, query, transaction: vi.fn(), healthCheck: vi.fn(), end: vi.fn() },
    })

    await expect(repository.getStore('operatorActions').upsertScoped('record-1', {}, {
      organizationId: 'org-b',
      teamWorkspaceId: 'team-a',
      userId: 'user-a',
    })).rejects.toMatchObject({ code: 'tenant_scope_conflict' })
    expect(query.mock.calls[0][0]).toContain('organization_id = EXCLUDED.organization_id')
  })

  it('keeps paper evaluation reads isolated by organization, team, account, and user', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createAtlasAiRepository({ database: { connected: true, query } })

    await repository.listPaperEvaluations({
      tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a' },
      accountId: 'account-a',
      userId: 'user-a',
    })

    expect(query.mock.calls[0][0]).toContain('account_id=$3 AND user_id=$4')
    expect(query.mock.calls[0][1]).toEqual(['org-a', 'team-a', 'account-a', 'user-a'])
  })

  it('rolls back and releases the transaction connection after a write failure', async () => {
    const query = vi.fn(async (sql) => {
      if (sql === 'write fails') throw new Error('write failed')
      return { rows: [] }
    })
    const release = vi.fn()
    const adapter = createDatabaseAdapter({
      client: { connected: true, connect: vi.fn(async () => ({ query, release })), query, end: vi.fn() },
    })

    await expect(adapter.transaction((client) => client.query('write fails'))).rejects.toThrow('write failed')
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'write fails', 'ROLLBACK'])
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('DB.1 migration and persistence classification', () => {
  it('keeps migration ids unique and deterministically ordered', () => {
    const ids = MIGRATIONS.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort())
  })

  it('makes migration failures visible to the caller', async () => {
    const database = {
      connected: true,
      query: vi.fn(async () => ({ rows: [] })),
      transaction: async (callback) => callback({
        query: vi.fn(async (sql) => {
          if (sql === 'BROKEN SQL') throw new Error('migration failed')
          return { rows: [] }
        }),
      }),
    }

    await expect(runMigrations(database, {
      migrations: [{ id: '209901010001_failure_probe', description: 'failure probe', statements: ['BROKEN SQL'] }],
    })).rejects.toThrow('migration failed')
  })

  it('contains no destructive migration statements', () => {
    expect(buildMigrationSql()).not.toMatch(/\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i)
  })

  it('identifies the canonical client repositories as process-local memory', () => {
    const source = fs.readFileSync('lib/repositories/store.js', 'utf8')
    expect(source).toContain('const state = {')
    expect(source).not.toContain('DATABASE_URL')
    expect(source).not.toContain("from 'pg'")
  })

  it('identifies canonical durable stores in tracked PostgreSQL migrations', () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('atlas_organizations')
    expect(sql).toContain('atlas_team_workspaces')
    expect(sql).toContain('atlas_operator_actions')
    expect(sql).toContain('atlas_ai_opportunity_analysis_history')
  })

  it('keeps the persistence hardening boundary free of trading, auth, and provider behavior imports', () => {
    const source = fs.readFileSync('lib/db/pgClient.js', 'utf8') + fs.readFileSync('lib/db/postgresRepository.js', 'utf8')
    expect(source).not.toMatch(/from ['"].*(?:trading|auth|provider)/i)
  })
})
