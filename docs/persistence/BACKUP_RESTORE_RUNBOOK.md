# Atlas Market backup and restore runbook

Status: **NOT VERIFIED / OWNER ACTION REQUIRED**
Scope: provider-neutral production PostgreSQL recovery specification
Last repository review: 2026-08-11

## Current evidence

The repository does not prove that production backups, point-in-time recovery, retention, restore automation, or a disaster-recovery owner exist. DB.1 did not contact production, configure a backup product, or add a paid service. The targets below are proposed operational goals, not current capabilities or service-level claims.

## Ownership

| Responsibility | Required owner | Current status |
| --- | --- | --- |
| Backup policy and provider configuration | Atlas infrastructure owner | OWNER ACTION REQUIRED |
| Daily backup success review | Named on-call/operator | OWNER ACTION REQUIRED |
| Restore authorization | Product owner + infrastructure owner | OWNER ACTION REQUIRED |
| Restore execution | Database administrator/infrastructure owner | OWNER ACTION REQUIRED |
| Application and tenant-integrity validation | Atlas engineering owner | OWNER ACTION REQUIRED |
| Incident communications | Named incident commander | OWNER ACTION REQUIRED |

Names and escalation contacts must be recorded in the private operational system, not committed to this public repository.

## Proposed recovery objectives

| Objective | Proposed target | Qualification |
| --- | --- | --- |
| RPO | 1 hour for durable production records | Requires provider-supported continuous logs/PITR or equivalent; otherwise the honest target is the verified backup interval (proposed maximum 24 hours) |
| RTO | 4 hours for database restore plus Atlas validation | Must be measured by a timed restore rehearsal; not currently verified |
| Daily backup | At least once every 24 hours | Proposed minimum, not verified |
| Retention | 30 daily recovery points and 12 monthly recovery points | Proposed target; legal/privacy requirements may require adjustment |
| Restore rehearsal | Quarterly and before a high-risk migration | Proposed target; evidence must include elapsed time and validation outcome |

If the selected database host cannot meet an approved RPO/RTO without a paid feature, stop and obtain owner approval before purchasing or changing service tiers. Do not claim the target is met.

## Required backup controls

1. Encrypt backups in transit and at rest.
2. Restrict backup and restore privileges to named operational roles with multi-factor authentication where supported.
3. Keep backup credentials separate from application runtime credentials.
4. Capture backup job id, start/end time, database identifier, logical/physical method, size, encryption status, and outcome without storing secrets.
5. Alert the named owner on a missed or failed backup.
6. Prevent backup exports from entering the repository, CI artifacts, browser storage, analytics, or ordinary application logs.
7. Document retention deletion and any legal hold before production approval.

## Backup verification procedure

Perform this procedure against the configured platform; do not infer success from a dashboard toggle.

1. Confirm the target database and environment using non-secret identifiers.
2. Confirm the most recent successful recovery point is within the approved RPO.
3. Confirm the recovery point is encrypted and retained through the expected expiry date.
4. Verify backup failure notification reaches the named operator.
5. Record evidence in the private release/operations record: timestamp, recovery-point id, operator, status, and redacted screenshot or provider report.
6. Never paste `DATABASE_URL`, passwords, certificates, tokens, raw customer data, or backup download links into evidence.

## Restore procedure

Unless a production disaster has been formally declared, restore only into an isolated non-production database.

1. Open an incident/change record and identify the authorized recovery point.
2. Freeze migrations and writes to the recovery target where applicable.
3. Create an isolated restore target with production-compatible PostgreSQL version, extensions, TLS policy, and capacity.
4. Restore the selected recovery point using the platform's documented mechanism.
5. Use a dedicated verification credential; do not reuse or expose the application secret.
6. Confirm PostgreSQL connectivity over verified TLS.
7. Inspect `atlas_schema_migrations`; compare count and ids with the expected release without applying new migrations automatically.
8. Run structural checks: required tables/indexes exist, row counts are plausible, foreign/unique constraints are valid, and no restore error remains.
9. Run two-tenant checks proving an organization/team/account/user cannot read or overwrite another tenant's records.
10. Run a controlled transaction rollback probe and verify no probe record remains.
11. Start Atlas against the isolated target with provider calls disabled or mocked as the approved test environment requires.
12. Run authenticated read-only smoke checks first, then approved reversible write checks.
13. Measure elapsed time from restore authorization to validated availability and compare it with the proposed RTO.
14. Destroy or retain the isolated copy according to the approved data-handling policy; record the disposition.

## Production disaster cutover

Production cutover requires explicit product and infrastructure owner authorization. Before changing Atlas configuration:

- establish the last known good recovery point and expected data-loss window;
- preserve the failed database for investigation when safe;
- confirm the restored target's TLS endpoint and connection capacity;
- rotate or issue least-privilege application credentials;
- run migration-ledger, tenant-isolation, rollback, and authenticated smoke checks;
- update the server-only `DATABASE_URL` through the deployment platform without printing it;
- monitor errors and connection saturation during a staged return to service;
- keep a documented rollback path until the recovery is accepted.

## Restore acceptance record

The private acceptance record must include:

- incident/change id and owners;
- backup/recovery-point id and timestamp;
- requested and actual RPO;
- requested and actual RTO;
- PostgreSQL version and migration-ledger result;
- tenant-isolation and rollback test results;
- application smoke result;
- unresolved discrepancies;
- approval or rejection decision;
- restored-copy retention/disposal decision.

## Exit criteria

Backup/restore can be marked verified only after a complete isolated restore succeeds, tenant isolation and rollback are demonstrated, measured RPO/RTO are recorded, owners accept the result, and evidence contains no secrets. Until then the production-readiness status remains **NOT VERIFIED / OWNER ACTION REQUIRED**.
