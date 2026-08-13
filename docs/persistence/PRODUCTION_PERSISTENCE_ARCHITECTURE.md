# Atlas Market production persistence architecture

Status: DB.1 verified repository contract; deployed database execution remains pending owner action
Verified against: `codex/audit-roadmap-control-inventory`, 2026-08-11

## Executive result

Atlas uses generic server-side PostgreSQL through `pg`; it does not contain a database-vendor SDK or managed proxy. DB.1 corrected the canonical adapter so it consumes the server-only `DATABASE_URL`, reuses one bounded pool per warm Netlify Function process, enforces production TLS, applies connection/query timeouts, and fails closed when production database configuration is absent.

This is repository-level verification, not proof of a deployed production database. No approved non-production `DATABASE_URL` was available during DB.1, so live connection, migration, tenant-isolation, transaction, backup, and restore execution are **NOT VERIFIED / OWNER ACTION REQUIRED**.

## Runtime connection contract

| Concern | Contract |
| --- | --- |
| Database URL | `DATABASE_URL` is required when `NODE_ENV=production`. It is read only by server code. Missing production configuration raises `database_configuration_missing`; local/test mode returns a disabled adapter. |
| TLS | Production defaults to `DATABASE_SSL_MODE=verify-full`. `require` is also accepted and certificate verification remains enabled. `disable` is rejected in production. Non-production may use `prefer` (default), `require`, `verify-full`, or `disable`. |
| Pooling | The canonical repository uses one process-level `pg.Pool`, reused across warm invocations. Default maximum is 5; `DATABASE_POOL_MAX` is clamped to 1–10. This is a per-process cap, not a deployment-wide cap. |
| Serverless lifecycle | Per-request repository cleanup does not close the shared pool. Idle connections are eligible to close after 30 seconds and `allowExitOnIdle` is enabled. An explicit shutdown helper exists for tests or controlled process shutdown. |
| Timeouts | Connection acquisition defaults to 5 seconds; query and statement timeouts default to 15 seconds; idle timeout defaults to 30 seconds. The corresponding environment overrides are `DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_QUERY_TIMEOUT_MS`, and `DATABASE_IDLE_TIMEOUT_MS`. |
| Transactions | `createDatabaseAdapter().transaction()` acquires one pooled connection, sends `BEGIN`, commits on success, rolls back on failure, and always releases the connection. |
| Failure behavior | Public persistence errors contain a stable code and generic message only. Driver messages and connection strings are not returned. Production does not silently downgrade to disabled persistence. |
| Migrations | The repository contains 70 unique, lexically ordered migrations tracked in `atlas_schema_migrations`. Each unapplied migration runs inside a transaction and failures propagate. Destructive SQL is prohibited by release verification. |

The legacy direct `pg.Client` helper uses the same `DATABASE_URL`, TLS, and timeout resolution. The canonical repository path uses the pool.

## Connection-capacity boundary

Pool reuse prevents a new pool from being created and closed on every request within one warm function process. It cannot enforce a global connection ceiling across all Netlify instances. At default settings, the theoretical connection demand is:

`active function processes × 5 connections`

The database owner must compare the provider's connection limit with expected function concurrency and set `DATABASE_POOL_MAX` conservatively. DB.1 did not add a pooler, proxy, provider, or paid service.

## Persistence inventory

“Durable-capable” means the SQL repository exists and is durable only when a working database is injected or reached through the canonical adapter. It does not mean deployed persistence was verified.

| Subsystem | Canonical mechanism | Durability now | Tenant scope | Transaction use | Production readiness / limitation |
| --- | --- | --- | --- | --- | --- |
| Identity user mapping | PostgreSQL auth repository | Durable-capable | Netlify subject/user record; organization membership resolved separately | Single statements | Repository contract present; deployed execution unverified |
| Organizations and memberships | PostgreSQL auth repository | Durable-capable | organization + user | Single statements | Tenant predicates present; deployed execution unverified |
| Team workspaces and invitations | PostgreSQL auth repositories | Durable-capable | organization + team; user/invite fields as applicable | Single statements | Some team lookups rely on the authenticated service layer to cross-check organization ownership |
| Opportunity/AI history | `createAtlasAiRepository` SQL | Durable for the PI.2 canonical review path when DB.1 is connected | organization + team + account + user | Single statements | Eligible reviewed TQ evidence uses the authenticated Function's pooled DB.1 adapter; disconnected persistence fails closed |
| Paper evaluations and simulation history | Atlas AI history table | Durable for canonical PA.1/PA.2 evidence when DB.1 is connected | organization + team + account + user | Single statements | Tenant-scoped hashed ids and database conflicts suppress unchanged evidence across instances; deployed DB execution remains unverified |
| Canonical paper account, executions, and positions | Dedicated PI.3 PostgreSQL tables | Durable-capable | organization + team + account + user | One transaction per entry/reduction/close; row locks, revisions, unique fingerprints | Canonical PA.2/PA.4 source; deployed execution unverified |
| Legacy paper positions and exit history | `operatorActions` PostgreSQL store | Compatibility-only | organization + team + user, plus owner check | Single statements | Not called by the canonical intelligence workflow; retirement remains future scope |
| Paper simulation intent and fill | PI.2 history intent followed by PI.3 transaction | Durable-capable | organization + team + account + user | Intent claim precedes one atomic execution/account/position transaction | PI.3 verifies durable evidence before accounting; duplicate execution cannot mutate account twice |
| Orders | `lib/repositories/store.js` array | Process-local only | No repository-level tenant key | None | Unsafe for multi-instance persistence; resets on cold start/redeploy |
| Portfolio/accounting | PI.3 canonical paper account for intelligence workflow; legacy arrays elsewhere | Canonical flow durable-capable; legacy path process-local | organization + team + account + user | Transactional in PA.2/PA.4 | Legacy `submit-paper-order` remains compatibility-only |
| Journal | Process-local repository array | Process-local only | No repository-level tenant key | None | Resets on cold start/redeploy |
| Alerts | Process-local repository array | Process-local only | No repository-level tenant key | None | Cannot provide durable alert history across instances |
| Scanner configuration/state | Process-local repository array | Process-local only | No repository-level tenant key | None | Configuration is not consistent across function instances |
| Strategy configuration | Runtime/static configuration and workspace inputs | Process-local/config only | Context dependent | None | No canonical durable strategy repository was verified |
| Workspace configuration/session records | Generic PostgreSQL stores | Durable-capable | Generic unscoped and scoped APIs both exist | Single statements | Unscoped legacy Function paths must not be treated as tenant-safe records |
| Operator actions and system events | Generic PostgreSQL stores | Durable-capable | scoped paths: organization + team + optional user | Single statements | Older unscoped list/write Functions still exist; scoped consumers must use scoped methods |
| Release/system records | SQL repositories in release engines | Disabled unless database is explicitly injected | usually organization + team + account | Single statements | Default Functions generally construct repositories without a database; schema presence is not runtime durability |

## Tenant-isolation findings

The canonical auth repositories apply organization/user predicates. Atlas AI paper/history queries use organization, nullable team, account, and user predicates. Generic scoped stores use organization/team predicates and now support a user predicate; paper-position reads require it. A scoped upsert can no longer change the organization, team, or user owner of an existing id.

Focused deterministic tests prove query construction and cross-organization conflict denial. A real two-tenant database exercise remains pending because no approved target was configured. Account isolation is available in the Atlas AI repository; the generic five-store schema has no account column and therefore cannot represent an account boundary.

## Transactions and atomicity findings

The adapter's transaction helper correctly rolls back on callback failure. Every migration is executed in its own transaction. Most repositories perform a single SQL statement and do not need a larger transaction.

PI.3 closes the canonical paper-account multi-write boundary: each entry/reduction/close appends its execution and updates account and position inside one DB.1 transaction. The PI.2 intent claim precedes that transaction; a retry may resume accounting from an existing intent because ledger uniqueness is the accounting idempotency authority. Other release workflows with create-plus-activity calls retain their prior independent-write behavior.

## Migration findings

- 69 migration ids are unique and deterministically ordered.
- The ledger table records applied ids; reruns skip recorded migrations.
- Each pending migration is transactional and a failure is visible to the caller.
- The migration corpus contains no `DROP TABLE`, `TRUNCATE`, or `DELETE FROM` operation.
- `createPostgresRepository().initialize()` runs the migration check, including from the database-health path. There is no dedicated, externally evidenced production migration owner or staging rehearsal.
- Concurrent cold starts may attempt the same idempotent DDL before the ledger entry is visible. The SQL is generally defensive, but DB.1 does not claim that every migration has been exercised under concurrent production startup.

Production rollout must assign one migration owner, rehearse against a restored non-production copy, capture the ledger before and after, and stop deployment on any migration failure. Startup must not treat an initialization error as healthy.

## Security findings

- No browser bundle imports `pg`, and `DATABASE_URL` is not referenced by browser code.
- Public persistence errors no longer carry the driver's internal message.
- No connection URL, credential, or recovery secret is logged or returned by the DB.1 code.
- Strict TLS is the production default and cannot be disabled in production.
- Pool configuration uses a hash only for internal same-process configuration comparison; the URL is never emitted.

## Owner actions required

1. Provision or identify an approved non-production PostgreSQL target compatible with production and authorize a DB.1 verification window.
2. Configure server-side `DATABASE_URL`; set `NODE_ENV=production`; confirm strict TLS; never create a `VITE_*` database variable.
3. Confirm the database connection ceiling, expected Netlify concurrency, and an appropriate `DATABASE_POOL_MAX` (1–10).
4. Run migrations once under a named owner, capture the migration ledger, and verify failed migrations block release.
5. Execute two-tenant organization/team/account/user read/write denial tests and a transaction rollback probe on the approved target.
6. Decide how to replace each process-local business store before making durable production claims.
7. Verify the PI.2 canonical opportunity/PA.1/PA.2 adapter wiring against the approved non-production target; separately approve any wiring of other AI/release repositories.
8. Complete and evidence the backup/restore runbook.

## Explicit non-changes

DB.1 did not change AUTH.1/AUTH.2, trading decisions, AI behavior, provider order or credentials, database vendor, database schema, risk logic, billing, or paid-service behavior. No migration or dependency was added.

PI.2 reused the same adapter and existing AI history table for reviewed opportunity and PA.1/PA.2 intent evidence. It did not add a migration or dependency and did not change authentication, scoring, strategy, risk formulas, AI, providers, live trading, database vendor, billing, or paid-service behavior.

## PI.3 paper accounting contract

Migration `202608130069_pi3_transactional_paper_account_ledger` creates additive account, immutable execution, and position-projection tables. PA.2/PA.4 use the DB.1 pooled adapter and fail closed without it. Account and position rows are locked and revision-guarded; execution fingerprints are unique per canonical account. PA.3/PA.5 derive realized outcomes from this ledger. See [Canonical paper account and execution ledger](./CANONICAL_PAPER_ACCOUNT_LEDGER.md).

Repository tests exercise initialization, restart continuity, rollback, concurrency, idempotency, long/short exits, tenant isolation, and migration constraints with a deterministic PostgreSQL transaction harness. No approved PostgreSQL target was available, so real database execution remains **NOT VERIFIED / OWNER ACTION REQUIRED**.
