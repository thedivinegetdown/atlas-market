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
  Object.freeze({
    id: '202607100012_phase33_policy_control_assurance',
    description: 'Phase 33 administrative policy governance, control assurance, and exception persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_administrative_policies (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        policy_domain TEXT NOT NULL,
        policy_status TEXT NOT NULL,
        review_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_administrative_policies_status
        ON atlas_administrative_policies (organization_id, team_workspace_id, policy_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_administrative_policies_review
        ON atlas_administrative_policies (organization_id, policy_domain, review_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_control_assurance_evaluations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        policy_id TEXT,
        control_id TEXT NOT NULL,
        control_status TEXT NOT NULL,
        assurance_level TEXT NOT NULL,
        exception_due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_control_assurance_status
        ON atlas_control_assurance_evaluations (organization_id, team_workspace_id, control_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_control_assurance_exception_due
        ON atlas_control_assurance_evaluations (organization_id, assurance_level, exception_due_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_policy_exceptions (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        policy_id TEXT,
        control_id TEXT,
        exception_status TEXT NOT NULL,
        exception_severity TEXT NOT NULL,
        exception_due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_policy_exceptions_status
        ON atlas_policy_exceptions (organization_id, team_workspace_id, exception_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_policy_exceptions_due
        ON atlas_policy_exceptions (organization_id, exception_severity, exception_due_date)`,
    ]),
  }),
  Object.freeze({
    id: '202607100013_phase34_attestation_control_testing',
    description: 'Phase 34 policy attestation and control testing persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_policy_attestations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        policy_id TEXT,
        control_id TEXT,
        attestation_status TEXT NOT NULL,
        expires_at TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_policy_attestations_status
        ON atlas_policy_attestations (organization_id, team_workspace_id, attestation_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_policy_attestations_expiry
        ON atlas_policy_attestations (organization_id, policy_id, expires_at)`,
      `CREATE TABLE IF NOT EXISTS atlas_control_tests (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        policy_id TEXT,
        control_id TEXT NOT NULL,
        test_status TEXT NOT NULL,
        next_test_due_at TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_control_tests_status
        ON atlas_control_tests (organization_id, team_workspace_id, test_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_control_tests_due
        ON atlas_control_tests (organization_id, control_id, next_test_due_at)`,
    ]),
  }),
  Object.freeze({
    id: '202607100014_phase34_compliance_operations',
    description: 'Phase 34 compliance evidence package and review workflow persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_evidence_packages (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        package_status TEXT NOT NULL,
        completeness_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_evidence_packages_status
        ON atlas_compliance_evidence_packages (organization_id, team_workspace_id, package_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_review_workflows (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        review_status TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_review_workflows_status
        ON atlas_compliance_review_workflows (organization_id, team_workspace_id, review_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_review_workflows_due
        ON atlas_compliance_review_workflows (organization_id, review_status, due_date)`,
    ]),
  }),
  Object.freeze({
    id: '202607100015_phase35_compliance_intake_review',
    description: 'Phase 35 compliance obligation, evidence request, and review finding persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_obligations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        obligation_domain TEXT NOT NULL,
        obligation_status TEXT NOT NULL,
        evidence_coverage_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_obligations_status
        ON atlas_compliance_obligations (organization_id, team_workspace_id, obligation_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_obligations_domain
        ON atlas_compliance_obligations (organization_id, obligation_domain, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_evidence_requests (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        request_status TEXT NOT NULL,
        request_priority TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_evidence_requests_status
        ON atlas_compliance_evidence_requests (organization_id, team_workspace_id, request_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_evidence_requests_priority
        ON atlas_compliance_evidence_requests (organization_id, request_priority, due_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_review_findings (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        finding_status TEXT NOT NULL,
        finding_severity TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_review_findings_status
        ON atlas_compliance_review_findings (organization_id, team_workspace_id, finding_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_review_findings_severity
        ON atlas_compliance_review_findings (organization_id, finding_severity, due_date)`,
    ]),
  }),
  Object.freeze({
    id: '202607100016_phase36_compliance_sla_escalation',
    description: 'Phase 36 compliance review SLA and escalation planning persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_review_sla_evaluations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        sla_status TEXT NOT NULL,
        sla_severity TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_review_sla_status
        ON atlas_compliance_review_sla_evaluations (organization_id, team_workspace_id, sla_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_review_sla_due
        ON atlas_compliance_review_sla_evaluations (organization_id, sla_severity, due_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_escalation_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        escalation_status TEXT NOT NULL,
        escalation_severity TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_escalation_plans_status
        ON atlas_compliance_escalation_plans (organization_id, team_workspace_id, escalation_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_escalation_plans_due
        ON atlas_compliance_escalation_plans (organization_id, escalation_severity, due_date)`,
    ]),
  }),
  Object.freeze({
    id: '202607100017_phase37_compliance_governance_schedule',
    description: 'Phase 37 compliance review calendar, attestation renewal, and governance readout persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_review_calendar_items (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        item_type TEXT NOT NULL,
        item_status TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_calendar_status
        ON atlas_compliance_review_calendar_items (organization_id, team_workspace_id, item_status, due_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_attestation_renewals (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        renewal_status TEXT NOT NULL,
        renewal_priority TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_attestation_renewals_status
        ON atlas_compliance_attestation_renewals (organization_id, team_workspace_id, renewal_status, due_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_governance_readouts (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        readout_status TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_governance_readouts_status
        ON atlas_compliance_governance_readouts (organization_id, team_workspace_id, readout_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607100018_phase38_compliance_audit_external_review',
    description: 'Phase 38 compliance audit readiness, external review planning, and governance decision persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_audit_readiness_packages (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        readiness_status TEXT NOT NULL,
        completeness_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_audit_readiness_status
        ON atlas_compliance_audit_readiness_packages (organization_id, team_workspace_id, readiness_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_external_review_requests (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        request_status TEXT NOT NULL,
        request_type TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_external_reviews_status
        ON atlas_compliance_external_review_requests (organization_id, team_workspace_id, request_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_external_reviews_due
        ON atlas_compliance_external_review_requests (organization_id, request_type, due_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_governance_decisions (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        decision_status TEXT NOT NULL,
        decision_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_governance_decisions_status
        ON atlas_compliance_governance_decisions (organization_id, team_workspace_id, decision_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607100019_phase39_compliance_records_exam_board',
    description: 'Phase 39 compliance record retention, exam readiness, and board packet persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_record_retention_reviews (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        retention_domain TEXT NOT NULL,
        review_status TEXT NOT NULL,
        review_due_at TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_record_retention_status
        ON atlas_compliance_record_retention_reviews (organization_id, team_workspace_id, review_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_record_retention_due
        ON atlas_compliance_record_retention_reviews (organization_id, retention_domain, review_due_at)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_exam_readiness_evaluations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        readiness_status TEXT NOT NULL,
        readiness_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_exam_readiness_status
        ON atlas_compliance_exam_readiness_evaluations (organization_id, team_workspace_id, readiness_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_board_packets (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        packet_status TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_board_packets_status
        ON atlas_compliance_board_packets (organization_id, team_workspace_id, packet_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607110020_phase40_compliance_meeting_program_health',
    description: 'Phase 40 compliance meeting minutes, governance action item, and program health persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_meeting_minutes (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        minutes_status TEXT NOT NULL,
        meeting_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_meeting_minutes_status
        ON atlas_compliance_meeting_minutes (organization_id, team_workspace_id, minutes_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_governance_action_items (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        action_status TEXT NOT NULL,
        action_priority TEXT NOT NULL,
        due_date TIMESTAMPTZ,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_action_items_status
        ON atlas_compliance_governance_action_items (organization_id, team_workspace_id, action_status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_action_items_priority
        ON atlas_compliance_governance_action_items (organization_id, action_priority, due_date)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_program_health_evaluations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        health_status TEXT NOT NULL,
        health_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_program_health_status
        ON atlas_compliance_program_health_evaluations (organization_id, team_workspace_id, health_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607110021_phase41_compliance_executive_reporting',
    description: 'Phase 41 compliance metrics snapshot, executive summary, and executive dashboard persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_metrics_snapshots (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        snapshot_status TEXT NOT NULL,
        health_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_metrics_snapshots_status
        ON atlas_compliance_metrics_snapshots (organization_id, team_workspace_id, snapshot_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_executive_summaries (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        summary_status TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_executive_summaries_status
        ON atlas_compliance_executive_summaries (organization_id, team_workspace_id, summary_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_executive_dashboards (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        dashboard_status TEXT NOT NULL,
        dashboard_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_executive_dashboards_status
        ON atlas_compliance_executive_dashboards (organization_id, team_workspace_id, dashboard_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607110022_phase42_compliance_trend_forecast_maturity',
    description: 'Phase 42 compliance trend analytics, risk forecast, and maturity assessment persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_trend_analytics (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        trend_status TEXT NOT NULL,
        trend_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_trend_analytics_status
        ON atlas_compliance_trend_analytics (organization_id, team_workspace_id, trend_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_risk_forecasts (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        forecast_status TEXT NOT NULL,
        forecast_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_risk_forecasts_status
        ON atlas_compliance_risk_forecasts (organization_id, team_workspace_id, forecast_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_maturity_assessments (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        maturity_level TEXT NOT NULL,
        maturity_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_maturity_assessments_level
        ON atlas_compliance_maturity_assessments (organization_id, team_workspace_id, maturity_level, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607110023_phase43_compliance_planning_analytics',
    description: 'Phase 43 compliance benchmark comparison, scenario planning, and resource planning persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_benchmark_comparisons (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        benchmark_status TEXT NOT NULL,
        benchmark_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_benchmark_comparisons_status
        ON atlas_compliance_benchmark_comparisons (organization_id, team_workspace_id, benchmark_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_scenario_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        scenario_status TEXT NOT NULL,
        scenario_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_scenario_plans_status
        ON atlas_compliance_scenario_plans (organization_id, team_workspace_id, scenario_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_resource_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        resource_status TEXT NOT NULL,
        resource_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_resource_plans_status
        ON atlas_compliance_resource_plans (organization_id, team_workspace_id, resource_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607110024_phase44_compliance_operational_readiness',
    description: 'Phase 44 compliance training, third-party oversight, and continuity readiness persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_training_readiness (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        training_status TEXT NOT NULL,
        training_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_training_readiness_status
        ON atlas_compliance_training_readiness (organization_id, team_workspace_id, training_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_third_party_oversight (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        oversight_status TEXT NOT NULL,
        oversight_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_third_party_oversight_status
        ON atlas_compliance_third_party_oversight (organization_id, team_workspace_id, oversight_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_continuity_readiness (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        continuity_status TEXT NOT NULL,
        continuity_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_continuity_readiness_status
        ON atlas_compliance_continuity_readiness (organization_id, team_workspace_id, continuity_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607110025_phase45_compliance_regulatory_change_management',
    description: 'Phase 45 compliance regulatory change intake, impact assessment, and implementation planning persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_regulatory_change_intake (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        change_status TEXT NOT NULL,
        change_priority_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_regulatory_change_intake_status
        ON atlas_compliance_regulatory_change_intake (organization_id, team_workspace_id, change_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_change_impact_assessments (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        impact_status TEXT NOT NULL,
        impact_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_change_impact_assessments_status
        ON atlas_compliance_change_impact_assessments (organization_id, team_workspace_id, impact_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_implementation_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        implementation_status TEXT NOT NULL,
        implementation_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_implementation_plans_status
        ON atlas_compliance_implementation_plans (organization_id, team_workspace_id, implementation_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607120026_phase46_compliance_change_followthrough',
    description: 'Phase 46 compliance implementation progress, change verification, and closure readiness persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_implementation_progress (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        progress_status TEXT NOT NULL,
        progress_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_implementation_progress_status
        ON atlas_compliance_implementation_progress (organization_id, team_workspace_id, progress_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_change_verifications (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        verification_status TEXT NOT NULL,
        verification_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_change_verifications_status
        ON atlas_compliance_change_verifications (organization_id, team_workspace_id, verification_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_change_closure_readiness (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        closure_status TEXT NOT NULL,
        closure_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_change_closure_readiness_status
        ON atlas_compliance_change_closure_readiness (organization_id, team_workspace_id, closure_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607120027_phase47_compliance_change_governance_learning',
    description: 'Phase 47 compliance post-implementation review, lessons learned, and change governance summary persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_post_implementation_reviews (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        review_status TEXT NOT NULL,
        review_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_post_implementation_reviews_status
        ON atlas_compliance_post_implementation_reviews (organization_id, team_workspace_id, review_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_lessons_learned (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        lesson_status TEXT NOT NULL,
        lesson_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_lessons_learned_status
        ON atlas_compliance_lessons_learned (organization_id, team_workspace_id, lesson_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_change_governance_summaries (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        governance_status TEXT NOT NULL,
        governance_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_change_governance_summaries_status
        ON atlas_compliance_change_governance_summaries (organization_id, team_workspace_id, governance_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607120028_phase48_compliance_improvement_adoption',
    description: 'Phase 48 compliance improvement opportunity and adoption readiness persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_improvement_opportunities (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        opportunity_status TEXT NOT NULL,
        opportunity_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_improvement_opportunities_status
        ON atlas_compliance_improvement_opportunities (organization_id, team_workspace_id, opportunity_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_adoption_readiness (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        adoption_status TEXT NOT NULL,
        adoption_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_adoption_readiness_status
        ON atlas_compliance_adoption_readiness (organization_id, team_workspace_id, adoption_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607130029_phase49_compliance_improvement_backlog_monitoring',
    description: 'Phase 49 compliance improvement backlog and adoption monitoring persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_improvement_backlog_items (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        backlog_status TEXT NOT NULL,
        backlog_priority TEXT NOT NULL,
        backlog_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_improvement_backlog_status
        ON atlas_compliance_improvement_backlog_items (organization_id, team_workspace_id, backlog_status, backlog_priority, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_adoption_monitoring (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        monitoring_status TEXT NOT NULL,
        monitoring_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_adoption_monitoring_status
        ON atlas_compliance_adoption_monitoring (organization_id, team_workspace_id, monitoring_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607130030_phase50_compliance_outcome_benefit',
    description: 'Phase 50 compliance improvement outcome review and benefit realization persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_improvement_outcome_reviews (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        outcome_status TEXT NOT NULL,
        outcome_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_improvement_outcome_reviews_status
        ON atlas_compliance_improvement_outcome_reviews (organization_id, team_workspace_id, outcome_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_benefit_realizations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        benefit_status TEXT NOT NULL,
        benefit_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_benefit_realizations_status
        ON atlas_compliance_benefit_realizations (organization_id, team_workspace_id, benefit_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607130031_phase51_compliance_continuous_optimization',
    description: 'Phase 51 compliance continuous improvement program and optimization roadmap persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_continuous_improvement_programs (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        program_status TEXT NOT NULL,
        program_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_continuous_improvement_programs_status
        ON atlas_compliance_continuous_improvement_programs (organization_id, team_workspace_id, program_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_optimization_roadmaps (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        roadmap_status TEXT NOT NULL,
        roadmap_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_optimization_roadmaps_status
        ON atlas_compliance_optimization_roadmaps (organization_id, team_workspace_id, roadmap_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607130032_phase52_compliance_strategic_planning',
    description: 'Phase 52 compliance strategic initiative portfolio and executive strategy plan persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_initiative_portfolios (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        initiative_status TEXT NOT NULL,
        initiative_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_strategic_initiative_portfolios_status
        ON atlas_compliance_strategic_initiative_portfolios (organization_id, team_workspace_id, initiative_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_executive_strategy_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        strategy_status TEXT NOT NULL,
        strategy_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_executive_strategy_plans_status
        ON atlas_compliance_executive_strategy_plans (organization_id, team_workspace_id, strategy_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607130033_phase53_compliance_strategic_execution',
    description: 'Phase 53 compliance strategic milestone planning and KPI tracking persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_milestone_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        milestone_status TEXT NOT NULL,
        milestone_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_strategic_milestone_plans_status
        ON atlas_compliance_strategic_milestone_plans (organization_id, team_workspace_id, milestone_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_kpi_evaluations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        kpi_status TEXT NOT NULL,
        kpi_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_strategic_kpi_evaluations_status
        ON atlas_compliance_strategic_kpi_evaluations (organization_id, team_workspace_id, kpi_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607130034_phase54_compliance_strategic_alignment_communication',
    description: 'Phase 54 compliance strategic stakeholder alignment and communication planning persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_stakeholder_alignments (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        alignment_status TEXT NOT NULL,
        alignment_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_strategic_stakeholder_alignments_status
        ON atlas_compliance_strategic_stakeholder_alignments (organization_id, team_workspace_id, alignment_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_communication_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        communication_status TEXT NOT NULL,
        communication_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_strategic_communication_plans_status
        ON atlas_compliance_strategic_communication_plans (organization_id, team_workspace_id, communication_status, updated_at DESC)`,
    ]),
  }),
  Object.freeze({
    id: '202607130035_phase55_compliance_strategic_feedback_effectiveness',
    description: 'Phase 55 compliance strategic feedback intake and communication effectiveness persistence.',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_feedback_intake (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        feedback_status TEXT NOT NULL,
        feedback_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_strategic_feedback_intake_status
        ON atlas_compliance_strategic_feedback_intake (organization_id, team_workspace_id, feedback_status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS atlas_compliance_strategic_communication_effectiveness (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        team_workspace_id TEXT,
        effectiveness_status TEXT NOT NULL,
        effectiveness_score NUMERIC,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_atlas_compliance_strategic_communication_effectiveness_status
        ON atlas_compliance_strategic_communication_effectiveness (organization_id, team_workspace_id, effectiveness_status, updated_at DESC)`,
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
