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
  Object.freeze({
    id: '202607100001_phase27_identity_authorization_foundation',
    description: 'Phase 27 identity and session tables for authenticated workspace API foundations.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        display_name TEXT,
        email TEXT,
        role TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (provider, provider_subject)
      )`,
      `CREATE TABLE IF NOT EXISTS atlas_user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES atlas_users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        refreshed_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_user_sessions_token_hash ON atlas_user_sessions (token_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_user_sessions_user_id ON atlas_user_sessions (user_id)`,
    ]),
  }),
  Object.freeze({
    id: '202607100002_phase27_organization_membership_foundation',
    description: 'Phase 27 organization and membership tables for protected organization workspace access.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id TEXT REFERENCES atlas_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS atlas_organization_memberships (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES atlas_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES atlas_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_org_memberships_active_user
        ON atlas_organization_memberships (organization_id, user_id)
        WHERE status = 'active'`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_org_memberships_org_status
        ON atlas_organization_memberships (organization_id, status)`,
    ]),
  }),
  Object.freeze({
    id: '202607100003_phase28_team_workspace_collaboration_foundation',
    description: 'Phase 28 team workspaces, team memberships, and invitation tables for shared workspace collaboration.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_team_workspaces (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES atlas_organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id TEXT REFERENCES atlas_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        archived_at TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_team_workspaces_org_status
        ON atlas_team_workspaces (organization_id, status)`,
      `CREATE TABLE IF NOT EXISTS atlas_team_workspace_memberships (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES atlas_organizations(id) ON DELETE CASCADE,
        team_workspace_id TEXT NOT NULL REFERENCES atlas_team_workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES atlas_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_team_memberships_active_user
        ON atlas_team_workspace_memberships (team_workspace_id, user_id)
        WHERE status = 'active'`,
      `CREATE TABLE IF NOT EXISTS atlas_membership_invitations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES atlas_organizations(id) ON DELETE CASCADE,
        team_workspace_id TEXT REFERENCES atlas_team_workspaces(id) ON DELETE CASCADE,
        invitee_email TEXT,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        invited_by_user_id TEXT REFERENCES atlas_users(id),
        accepted_by_user_id TEXT REFERENCES atlas_users(id),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_invitations_token_hash
        ON atlas_membership_invitations (token_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_invitations_org_status
        ON atlas_membership_invitations (organization_id, status)`,
    ]),
  }),
  Object.freeze({
    id: '202607100004_phase28_admin_session_governance_foundation',
    description: 'Phase 28 administration, session security, and collaboration governance support.',
    statements: Object.freeze([
      `ALTER TABLE atlas_user_sessions
        ADD COLUMN IF NOT EXISTS device_fingerprint TEXT`,
      `ALTER TABLE atlas_user_sessions
        ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE atlas_user_sessions
        ADD COLUMN IF NOT EXISTS ip_address TEXT`,
      `ALTER TABLE atlas_user_sessions
        ADD COLUMN IF NOT EXISTS user_agent TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_user_sessions_user_status
        ON atlas_user_sessions (user_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_user_sessions_last_seen
        ON atlas_user_sessions (user_id, last_seen_at)`,
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
