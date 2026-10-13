import { describe, expect, it, vi } from 'vitest'
import { createPostgresRepository } from '../lib/db/postgresRepository.js'
import { createOrReusePreparation } from '../lib/workspace/governedReviewPreparation.js'
import { claimPreparation } from '../netlify/functions/governed-review-prepare-background.js'
import { MIGRATIONS, runMigrations } from '../lib/db/migrations.js'

describe('governed review preparation PostgreSQL contract', () => {
  it('persists lifecycle fields, reuses the active record, and atomically claims it', async () => {
    const scope = { organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'user-1' }
    const createdAt = new Date()
    let saved
    let inserts = 0
    const query = vi.fn(async (sql, params) => {
      if (sql.includes('INSERT INTO atlas_governed_review_preparations')) {
        inserts += 1
        if (inserts > 1) {
          const error = new Error('duplicate key value violates unique constraint idx_atlas_governed_review_preparations_active_unique')
          error.code = '23505'
          throw error
        }
        saved = { id: params[0], payload: params[5], organization_id: params[1], team_workspace_id: params[2], user_id: params[3], status: params[4], expires_at: params[8], attempt: params[9], claim_token: params[10] }
        return { rows: [saved], rowCount: 1 }
      }
      if (sql.includes('FROM atlas_governed_review_preparations') && sql.includes('ORDER BY CASE WHEN status IN')) return { rows: [saved] }
      if (sql.includes('WHERE id = $1') && sql.includes('SELECT id')) return { rows: [saved] }
      if (sql.includes("SET status = 'expired'")) return { rows: [], rowCount: 0 }
      if (sql.startsWith('UPDATE atlas_governed_review_preparations')) return { rows: [{ id: saved.id }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    const repository = createPostgresRepository({ database: { connected: true, query, transaction: vi.fn(), healthCheck: vi.fn() } })

    const first = await createOrReusePreparation(repository, scope.organizationId, scope.userId, scope, () => createdAt)
    const second = await createOrReusePreparation(repository, scope.organizationId, scope.userId, scope, () => createdAt)
    const claim = await claimPreparation(repository, first.preparation.id, scope)

    const insertCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO atlas_governed_review_preparations'))
    const insertSql = insertCall[0]
    expect(insertSql).toContain('status, payload')
    expect(insertSql).toContain('created_at, updated_at, expires_at, attempt, claim_token')
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      'pending', first.preparation, first.preparation.createdAt, first.preparation.updatedAt,
      first.preparation.expiresAt, 0, first.preparation.claimToken,
    ]))
    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, existingId: first.preparation.id })
    expect(claim).toMatchObject({ claimed: true, preparation: { status: 'running', attempt: 1 } })
    const claimSql = query.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('claim_token') && sql.includes('payload = payload || $10::jsonb'))
    expect(claimSql).toContain('claim_token')
    expect(claimSql).toContain('payload = payload || $10::jsonb')
    expect(claimSql).toContain('status = $11')
  })

  it('applies the lifecycle repair on both a clean install and an upgraded database', async () => {
    const repair = MIGRATIONS.find(({ id }) => id === '202609120002_governed_review_preparations_physical_lifecycle_contract')
    const apply = async (appliedIds) => {
      const statements = []
      await runMigrations({
        connected: true,
        query: vi.fn(async () => ({ rows: [] })),
        transaction: async (callback) => callback({
          query: async (sql, params) => {
            if (sql.startsWith('SELECT id FROM atlas_schema_migrations')) return { rows: appliedIds.has(params[0]) ? [{ id: params[0] }] : [] }
            statements.push(sql)
            return { rows: [] }
          },
        }),
      })
      return statements
    }
    const cleanStatements = await apply(new Set())
    const upgradeStatements = await apply(new Set(MIGRATIONS.filter(({ id }) => id !== repair.id).map(({ id }) => id)))

    expect(cleanStatements).toContain(repair.statements[0])
    expect(upgradeStatements.slice(0, repair.statements.length)).toEqual(repair.statements)
    expect(repair.statements.join('\n')).toContain("COALESCE(team_workspace_id, '')")
  })

  it('keeps one durable operation for concurrent same-scope starts and the same key after terminal completion', async () => {
    const rows = []
    const sameScope = (row, organizationId, teamWorkspaceId, userId) => row.organization_id === organizationId
      && (row.team_workspace_id ?? '') === (teamWorkspaceId ?? '') && row.user_id === userId
    const query = vi.fn(async (sql, params) => {
      if (sql.startsWith('UPDATE atlas_governed_review_preparations') && sql.includes("SET status = 'expired'")) {
        const [organizationId, teamWorkspaceId, userId] = params
        const expired = rows.filter((row) => sameScope(row, organizationId, teamWorkspaceId, userId)
          && ['pending', 'running'].includes(row.status) && new Date(row.expires_at).getTime() <= Date.now())
        for (const row of expired) {
          row.status = 'expired'
          row.payload = { ...row.payload, status: 'expired' }
        }
        return { rows: expired.map(({ id }) => ({ id })), rowCount: expired.length }
      }
      if (sql.includes('INSERT INTO atlas_governed_review_preparations')) {
        const [id, organizationId, teamWorkspaceId, userId, status, payload] = params
        const key = payload.idempotencyKey
        const duplicateKey = rows.some((row) => sameScope(row, organizationId, teamWorkspaceId, userId) && key && row.payload.idempotencyKey === key)
        const active = rows.some((row) => sameScope(row, organizationId, teamWorkspaceId, userId) && ['pending', 'running'].includes(row.status))
        if (duplicateKey || active) {
          const error = new Error(`duplicate key value violates unique constraint idx_atlas_governed_review_preparations_${duplicateKey ? 'request' : 'active'}_unique`)
          error.code = '23505'
          throw error
        }
        const row = { id, organization_id: organizationId, team_workspace_id: teamWorkspaceId, user_id: userId, status, payload, updated_at: payload.updatedAt, expires_at: params[8] }
        rows.push(row)
        return { rows: [row], rowCount: 1 }
      }
      if (sql.includes("payload->>'idempotencyKey' = $4")) {
        const [organizationId, teamWorkspaceId, userId, key] = params
        return { rows: rows.filter((row) => sameScope(row, organizationId, teamWorkspaceId, userId) && row.payload.idempotencyKey === key) }
      }
      if (sql.includes('ORDER BY CASE WHEN status IN')) {
        const [organizationId, teamWorkspaceId, userId] = params
        const scoped = rows.filter((row) => sameScope(row, organizationId, teamWorkspaceId, userId))
        return { rows: scoped.filter((row) => ['pending', 'running'].includes(row.status)).slice(0, 1).concat(scoped.filter((row) => !['pending', 'running'].includes(row.status)).slice(0, 1)).slice(0, 1) }
      }
      return { rows: [] }
    })
    const repository = createPostgresRepository({ database: { connected: true, query } })
    const scope = { organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'user-1' }
    const start = (key, currentScope = scope) => createOrReusePreparation(repository, currentScope.organizationId, currentScope.userId, currentScope, () => new Date('2026-10-13T18:00:00.000Z'), key)

    const [first, sameRequest] = await Promise.all([start('logical-request-0001'), start('logical-request-0001')])
    expect(rows).toHaveLength(1)
    expect(first.preparation.id).toBe(sameRequest.preparation.id)
    expect([first.created, sameRequest.created].sort()).toEqual([false, true])
    expect([first.reuseReason, sameRequest.reuseReason]).toContain('idempotent')

    const otherRequestWhileActive = await start('logical-request-0002')
    expect(otherRequestWhileActive).toMatchObject({ created: false, reuseReason: 'active', existingId: first.preparation.id })
    expect(rows).toHaveLength(1)

    rows[0].status = 'completed'
    rows[0].payload = { ...rows[0].payload, status: 'completed' }
    const terminalRetry = await start('logical-request-0001')
    expect(terminalRetry).toMatchObject({ created: false, reuseReason: 'idempotent', existingId: first.preparation.id })
    expect(rows).toHaveLength(1)

    const explicitNewRequest = await start('logical-request-0002')
    expect(explicitNewRequest).toMatchObject({ created: true, reuseReason: null })
    expect(rows).toHaveLength(2)
    rows[1].expires_at = '2026-10-12T00:00:00.000Z'
    const afterExpiry = await start('logical-request-0003')
    expect(rows[1].status).toBe('expired')
    expect(afterExpiry.created).toBe(true)
    expect(rows).toHaveLength(3)
    const otherWorkspace = await start('logical-request-0001', { ...scope, teamWorkspaceId: 'team-2' })
    expect(otherWorkspace.created).toBe(true)
    const otherOrganization = await start('logical-request-0001', { ...scope, organizationId: 'org-2' })
    const otherUser = await start('logical-request-0001', { ...scope, userId: 'user-2' })
    expect(otherOrganization.created).toBe(true)
    expect(otherUser.created).toBe(true)
    expect(rows).toHaveLength(6)
  })

  it('adds a scope-bound request identity unique index across terminal states', () => {
    const migration = MIGRATIONS.find(({ id }) => id === '202610130001_governed_review_start_idempotency')
    const sql = migration.statements.join('\n')
    expect(sql).toContain('CREATE UNIQUE INDEX')
    expect(sql).toContain("(organization_id, user_id, COALESCE(team_workspace_id, ''), (payload->>'idempotencyKey'))")
    expect(sql).not.toContain("WHERE status IN ('pending', 'running')")
  })
})
