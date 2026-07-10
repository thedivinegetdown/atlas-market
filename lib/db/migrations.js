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
  Object.freeze({
    id: '202607100005_phase29_tenant_isolation_audit_access_review',
    description: 'Phase 29 tenant-scoped persistence ownership and administrative audit lookup support.',
    statements: Object.freeze([
      `ALTER TABLE atlas_workspace_configurations
        ADD COLUMN IF NOT EXISTS organization_id TEXT`,
      `ALTER TABLE atlas_workspace_configurations
        ADD COLUMN IF NOT EXISTS team_workspace_id TEXT`,
      `ALTER TABLE atlas_workspace_configurations
        ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `ALTER TABLE atlas_system_events
        ADD COLUMN IF NOT EXISTS organization_id TEXT`,
      `ALTER TABLE atlas_system_events
        ADD COLUMN IF NOT EXISTS team_workspace_id TEXT`,
      `ALTER TABLE atlas_system_events
        ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `ALTER TABLE atlas_operator_actions
        ADD COLUMN IF NOT EXISTS organization_id TEXT`,
      `ALTER TABLE atlas_operator_actions
        ADD COLUMN IF NOT EXISTS team_workspace_id TEXT`,
      `ALTER TABLE atlas_operator_actions
        ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `ALTER TABLE atlas_enterprise_audit_records
        ADD COLUMN IF NOT EXISTS organization_id TEXT`,
      `ALTER TABLE atlas_enterprise_audit_records
        ADD COLUMN IF NOT EXISTS team_workspace_id TEXT`,
      `ALTER TABLE atlas_enterprise_audit_records
        ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_workspace_configurations_tenant
        ON atlas_workspace_configurations (organization_id, team_workspace_id, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_system_events_tenant
        ON atlas_system_events (organization_id, team_workspace_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_operator_actions_tenant
        ON atlas_operator_actions (organization_id, team_workspace_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_audit_records_tenant
        ON atlas_enterprise_audit_records (organization_id, team_workspace_id, category, created_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607100006_phase30_account_preferences_foundation',
    description: 'Phase 30 user account profiles and notification preference foundations.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_user_profiles (
        user_id TEXT PRIMARY KEY REFERENCES atlas_users(id) ON DELETE CASCADE,
        display_name TEXT,
        timezone TEXT,
        locale TEXT,
        preferred_workspace TEXT,
        accessibility_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_user_profiles_preferred_workspace
        ON atlas_user_profiles (preferred_workspace)`,
      `CREATE TABLE IF NOT EXISTS atlas_notification_preferences (
        user_id TEXT PRIMARY KEY REFERENCES atlas_users(id) ON DELETE CASCADE,
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_notification_preferences_updated
        ON atlas_notification_preferences (updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607100007_phase30_notifications_activity_workflows',
    description: 'Phase 30 in-app notification center and tenant administration workflow foundations.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_in_app_notifications (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        user_id TEXT NOT NULL REFERENCES atlas_users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_in_app_notifications_user_status_created
        ON atlas_in_app_notifications (organization_id, team_workspace_id, user_id, status, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_in_app_notifications_tenant_created
        ON atlas_in_app_notifications (organization_id, team_workspace_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_tenant_administration_workflows (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        category TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_tenant_workflows_status_updated
        ON atlas_tenant_administration_workflows (organization_id, team_workspace_id, status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_tenant_workflows_priority
        ON atlas_tenant_administration_workflows (organization_id, priority, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607100008_phase31_operator_intelligence',
    description: 'Phase 31 operator intelligence notification digest persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_notification_digests (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        user_id TEXT NOT NULL REFERENCES atlas_users(id) ON DELETE CASCADE,
        frequency TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_notification_digests_user_created
        ON atlas_notification_digests (organization_id, team_workspace_id, user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_notification_digests_frequency
        ON atlas_notification_digests (organization_id, frequency, created_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607100009_phase31_admin_cases_command_center',
    description: 'Phase 31 administrative case management persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_administrative_cases (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        owner_user_id TEXT REFERENCES atlas_users(id),
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_administrative_cases_tenant_status
        ON atlas_administrative_cases (organization_id, team_workspace_id, status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_administrative_cases_priority_due
        ON atlas_administrative_cases (organization_id, priority, due_date)`,
    ]),
  }),
  Object.freeze({
    id: '202607100010_phase32_evidence_remediation',
    description: 'Phase 32 administrative evidence and remediation planning persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_administrative_evidence (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        related_case_id TEXT,
        evidence_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        review_status TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_admin_evidence_case_review
        ON atlas_administrative_evidence (organization_id, team_workspace_id, related_case_id, review_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_admin_evidence_type_severity
        ON atlas_administrative_evidence (organization_id, evidence_type, severity, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_remediation_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        related_case_id TEXT,
        approval_status TEXT NOT NULL,
        execution_status TEXT NOT NULL,
        priority TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_remediation_plans_status
        ON atlas_remediation_plans (organization_id, team_workspace_id, approval_status, execution_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_remediation_plans_due
        ON atlas_remediation_plans (organization_id, priority, due_date)`,
    ]),
  }),
  Object.freeze({
    id: '202607100011_phase32_governance_effectiveness',
    description: 'Phase 32 evidence governance and remediation effectiveness evaluation persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_evidence_governance_evaluations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        evidence_id TEXT NOT NULL,
        related_case_id TEXT,
        governance_status TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        retention_review_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_evidence_governance_status
        ON atlas_evidence_governance_evaluations (organization_id, team_workspace_id, governance_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_evidence_governance_retention
        ON atlas_evidence_governance_evaluations (organization_id, risk_level, retention_review_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_remediation_effectiveness_evaluations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        remediation_plan_id TEXT NOT NULL,
        related_case_id TEXT,
        effectiveness_rating TEXT NOT NULL,
        residual_risk TEXT NOT NULL,
        follow_up_due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_remediation_effectiveness_rating
        ON atlas_remediation_effectiveness_evaluations (organization_id, team_workspace_id, effectiveness_rating, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_remediation_effectiveness_follow_up
        ON atlas_remediation_effectiveness_evaluations (organization_id, residual_risk, follow_up_due_date)`,
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
