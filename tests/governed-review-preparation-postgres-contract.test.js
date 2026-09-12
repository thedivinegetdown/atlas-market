import { describe, expect, it, vi } from 'vitest'
import { createPostgresRepository } from '../lib/db/postgresRepository.js'
import { createOrReusePreparation } from '../lib/workspace/governedReviewPreparation.js'
import { claimPreparation } from '../netlify/functions/governed-review-prepare-background.js'
import { MIGRATIONS, runMigrations } from '../lib/db/migrations.js'

describe('governed review preparation PostgreSQL contract', () => {
  it('persists lifecycle fields, reuses the active record, and atomically claims it', async () => {
    const scope = { organizationId: 'org-1', teamWorkspaceId: 'team-1', userId: 'user-1' }
    const createdAt = new Date('2026-09-12T12:00:00.000Z')
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
      if (sql.includes('FROM atlas_governed_review_preparations') && sql.includes('ORDER BY updated_at')) return { rows: [saved] }
      if (sql.includes('WHERE id = $1') && sql.includes('SELECT id')) return { rows: [saved] }
      if (sql.startsWith('UPDATE atlas_governed_review_preparations')) return { rows: [{ id: saved.id }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    const repository = createPostgresRepository({ database: { connected: true, query, transaction: vi.fn(), healthCheck: vi.fn() } })

    const first = await createOrReusePreparation(repository, scope.organizationId, scope.userId, scope, () => createdAt)
    const second = await createOrReusePreparation(repository, scope.organizationId, scope.userId, scope, () => createdAt)
    const claim = await claimPreparation(repository, first.preparation.id, scope)

    const insertSql = query.mock.calls[0][0]
    expect(insertSql).toContain('status, payload')
    expect(insertSql).toContain('created_at, updated_at, expires_at, attempt, claim_token')
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'pending', first.preparation, first.preparation.createdAt, first.preparation.updatedAt,
      first.preparation.expiresAt, 0, first.preparation.claimToken,
    ]))
    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, existingId: first.preparation.id })
    expect(claim).toMatchObject({ claimed: true, preparation: { status: 'running', attempt: 1 } })
    const claimSql = query.mock.calls.at(-1)[0]
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
    const upgradeStatements = await apply(new Set(MIGRATIONS.slice(0, -1).map(({ id }) => id)))

    expect(cleanStatements).toContain(repair.statements[0])
    expect(upgradeStatements.slice(0, repair.statements.length)).toEqual(repair.statements)
    expect(repair.statements.join('\n')).toContain("COALESCE(team_workspace_id, '')")
  })
})
