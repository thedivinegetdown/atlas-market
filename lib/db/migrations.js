export const MIGRATIONS = Object.freeze([
  Object.freeze({
    id: '202607090001_phase26_persistence_foundation',
    description: 'Phase 26 persistence foundation tables for workspace, events, audit, and operator actions.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_schema_migrations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS atlas_workspace_configurations (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS atlas_workspace_sessions (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS atlas_system_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_system_events_event_type ON atlas_system_events (event_type)`,
      `CREATE TABLE IF NOT EXISTS atlas_enterprise_audit_records (
        id TEXT PRIMARY KEY,
        category TEXT,
        severity TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS atlas_operator_actions (
        id TEXT PRIMARY KEY,
        status TEXT,
        severity TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    ]),
  }),
])

export function buildMigrationSql(migrations = MIGRATIONS) {
  return migrations.flatMap((migration) => migration.statements).join(';\n')
}

export async function runMigrations(database, { migrations = MIGRATIONS } = {}) {
  if (!database?.connected) {
    return {
      ok: true,
      disabled: true,
      applied: [],
      skipped: migrations.map((migration) => migration.id),
    }
  }

  const applied = []
  await database.query(`CREATE TABLE IF NOT EXISTS atlas_schema_migrations (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )`)

  for (const migration of migrations) {
    await database.transaction(async (client) => {
      const existing = await client.query('SELECT id FROM atlas_schema_migrations WHERE id = $1', [migration.id])
      if (existing.rows.length > 0) return

      for (const statement of migration.statements) {
        await client.query(statement)
      }

      await client.query(
        'INSERT INTO atlas_schema_migrations (id, description) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [migration.id, migration.description],
      )
      applied.push(migration.id)
    })
  }

  return {
    ok: true,
    disabled: false,
    applied,
    skipped: migrations.filter((migration) => !applied.includes(migration.id)).map((migration) => migration.id),
  }
}
