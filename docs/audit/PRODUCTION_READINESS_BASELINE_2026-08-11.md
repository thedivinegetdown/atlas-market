# Atlas Market Production-Readiness Baseline

Status: v1 production-hardening baseline with deployed release-closure evidence

Verified: 2026-08-14

Scope: authentication, API controls, persistence, market-data degradation, CI/release gates, and release blockers

This document records source, database, and deployed production verification. Atlas remains analysis and paper/simulated execution only; no live broker or real-money path is enabled.

## Executive conclusion

Atlas v1 has a reachable authenticated Netlify production deployment, a passing production build and release gate, durable PostgreSQL paper-account persistence, shared API controls, and explicit paper-only trading boundaries. The release-blocking authentication, authorization, CSRF, migration, durable-accounting, secret-scan, and live/mock ambiguity checks are green.

AUTH.1 supplies an invite-only Netlify Identity browser/session foundation and a fail-closed production verifier. AUTH.2 protects the former 12 P0 mutations and eight P1 sensitive reads, leaving only two explicitly public reads, and replaces presence-only CSRF with a short-lived server-issued session-bound token. The production PostgreSQL contract is code-hardened but production rollout/backup execution remains unverified, compatibility stores remain process-local, market-data degradation remains operationally dependent on provider credentials, and CI enforces deterministic repository gates.

## Authentication architecture and browser gap

The shared authenticated Function path is implemented by `netlify/functions/_shared/authApi.js`:

1. extract a bearer token or `atlas_session` cookie;
2. apply an environment-aware exact-origin allowlist;
3. call the configured authentication adapter;
4. validate session status and expiry;
5. cryptographically validate an expiring bearer/user/session-bound `x-csrf-token` for authenticated mutations;
6. evaluate role permissions;
7. optionally enforce organization and team membership boundaries.

The local adapter remains explicitly `productionSafe: false` and is restricted to development/test selection. Production selects the Netlify Identity adapter, verifies the provider session through the site Identity service, and fails closed when verification is missing, invalid, expired, rejected, or unavailable. Atlas organization/team membership remains authoritative after provider verification.

The browser session layer attaches the current Identity bearer. The shared API client establishes CSRF only for mutations, stores it only in closure memory, retries once after expiry/invalidity, and clears it at logout or bearer change. Repository tests remain deterministic and do not prove the deployed Identity browser flow.

Read-only production checks on 2026-08-11 returned HTTP 200 for the SPA root, `/dashboard`, `/markets`, and the public health Function. An unauthenticated `market-overview?symbol=SPY` request returned HTTP 401. This proves deployment reachability and enforcement at that endpoint, not a working browser sign-in flow.

## API control inventory

The generated [Markdown inventory](../architecture/API_CONTROL_INVENTORY.md) and [JSON inventory](../architecture/api-control-inventory.json) cover every `netlify/functions/*.js` entry point. Regenerate them with `npm run audit:api-controls`; CI checks freshness with `npm run audit:api-controls:check`.

| Wrapper/control | Count | Boundary represented in source |
| --- | ---: | --- |
| Team-authenticated | 8 | Organization and team |
| Organization-authenticated | 243 | Organization |
| Authenticated | 21 | Authenticated user/workspace role |
| Plain shared API | 2 | Intentional public read |
| Unknown | 0 | N/A |
| **Total** | **274** | |

Method classification is 77 read-only, 56 mutation-only, and 141 mixed read/mutation Functions. Source classification produces zero P0, zero P1, zero P2, and 274 P3 entries.

### Remediated P0 plain-wrapper mutations

These former P0 endpoints now require organization membership, account context, owner/admin workspace-write authority, and verified CSRF:

- `cancel-paper-order`
- `create-alert`
- `create-scanner`
- `delete-alert`
- `delete-scanner`
- `evaluate-alerts`
- `evaluate-scanners`
- `recalculate-portfolio`
- `submit-paper-order`
- `update-alert`
- `update-scanner`
- `workspace-configurations` (`GET` and `POST`)

The legacy paper-order, alert/scanner, and recalculation routes are explicitly compatibility-only; PI.3/PI.4 remain canonical. Paper-only and no-broker boundaries are unchanged.

### Remediated P1 sensitive plain reads

- `journal-summary`
- `operator-actions`
- `orders`
- `portfolio-summary`
- `positions`
- `risk-summary`
- `signals`
- `system-events`

These now require organization membership plus account/user scope. Process-memory legacy projections remain compatibility-only and non-durable; operator/system/configuration persistence uses scoped repository methods.

Only `health` and `watchlist` remain plain. Both are documented `PUBLIC_READ` routes with no mutation, tenant data, or privileged operational diagnostics. Database and release runtime health are now admin-authenticated. The inventory records the exact classification and reason for every reconciled route.

## Persistence limitations

Atlas uses server-side `pg`, code-managed migrations, and repository abstractions. DB.1 wires the canonical adapter to the server-only `DATABASE_URL`, requires it in production, enforces verified TLS, bounds connection/query timeouts, and reuses one pool per warm serverless process (default 5, hard maximum 10). Local/test execution without a URL remains explicitly disabled. Public persistence errors do not include driver messages.

Several core repositories—legacy orders, portfolio/accounting, journal, alerts, and scanner state—still use process-memory arrays and are neither durable nor consistent across serverless instances. PI.2 wires reviewed Trade Quality and PA.1/PA.2 intent evidence to the authenticated DB.1 adapter. PI.3 adds a canonical transactional paper account, immutable execution ledger, and account-scoped positions for PA.2/PA.4, with fail-closed behavior, tenant-scoped ids, row locks, revisions, and database-level retry suppression. Other SQL-capable AI/release repositories may still require explicit wiring. The detailed inventory and production contract are in `docs/persistence/PRODUCTION_PERSISTENCE_ARCHITECTURE.md`.

PI.1 through PI.3 are recorded in `docs/persistence/PAPER_WORKFLOW_PERSISTENCE_GAP_ANALYSIS.md` and `docs/persistence/CANONICAL_PAPER_ACCOUNT_LEDGER.md`. The canonical intelligence path is Reviewed Opportunity → PA.1 → PA.2. The legacy `submit-paper-order` path is compatibility-only. PA.2 now uses the durable account and commits entries transactionally; PA.4 commits reductions/closes and realized P&L against the same source. The daily quota is still not a distributed atomic control, the legacy `submit-paper-order` path remains compatibility-only, and deployed PostgreSQL execution is unverified.

The repository contains no Supabase SDK, Supabase Auth, Realtime, Storage, or vendor-specific integration. A Supabase-hosted PostgreSQL URL is compatible in principle but is not a verified Supabase integration. No approved database target was configured for DB.1, so live connectivity, migration rehearsal, tenant denial, rollback, backup, restore, retention, and RPO/RTO execution remain **NOT VERIFIED / OWNER ACTION REQUIRED**. No schema change is authorized by this baseline.

## Market-data degraded and mock behavior

Current quote routing attempts Finnhub, then Twelve Data, then the deterministic mock provider. Quote responses retain provider attribution, but a successful mock fallback can keep the application usable when provider credentials or services are unavailable. UI and operator surfaces must therefore distinguish real provider data, stale data, degraded state, and mock data without implying that mock values are live.

Historical daily candles use Twelve Data only for the approved 260-candle request. They use a five-minute process-local cache, in-flight request deduplication, process-local request budgets, timeout handling, and retry-after backoff. No mock or synthetic historical fallback is approved. Failure is returned transparently when genuine historical candles are unavailable.

Provider credentials, quotas, entitlements, and production freshness are deployment facts outside repository evidence. No provider or billing change is authorized here.

## CI and release-gate gaps

GitHub Actions uses Node 22 and locked `npm ci`, then runs `npm run ci:verify` on pull requests and pushes to `main`. The shared verifier enforces production configuration validation, API-control inventory freshness, the full Vitest suite, lint with the approved warning baseline, production build, performance budget, migration safety, sensitive-material scanning, and generated-artifact checks. Superseded runs on the same ref are cancelled.

Local `npm run release:verify` uses the same gates and additionally runs the focused security/release subset before the full suite for fast local diagnosis. CI mode omits that redundant subset because those tests are already in the full suite. Neither mode proves Netlify Identity email delivery, production provider credentials/entitlements, production database connectivity/backups, deployed route behavior, or authenticated browser journeys; those remain manual/deployed evidence.

## Production-readiness blockers

1. Netlify Identity site configuration, invite-only enforcement, first-owner invitation/explicit role assignment, and authenticated production smoke evidence remain external release gates.
2. AUTH.1 browser/session and production-verifier code exists, but deployed callback, refresh, expiry, and logout behavior is not yet evidenced.
3. AUTH.2 source controls require deployed verification against real Netlify Identity sessions, origins, roles, memberships, and CSRF lifecycle behavior.
4. PI.3 provides the repository-level canonical transactional paper account/execution/position ledger, but production migration, capacity, migration ownership, backup, restore, retention, and RPO/RTO remain unverified. The legacy paper-order path and non-distributed daily quota remain limitations.
5. MD.1 makes live, delayed, stale, degraded, mock, unavailable, and unknown provenance explicit in the principal market workspaces; production provider entitlement, delay, and freshness evidence remains unverified.
6. CI gates are deterministic repository checks and do not replace deployed authenticated smoke/E2E evidence.
7. No repeatable authenticated production smoke/E2E evidence exists.
8. Documentation must avoid treating deterministic engines and tests as proof of production integration.

## Remediation order

1. Review and accept this baseline and generated inventory.
2. Complete the Netlify Identity manual setup and production smoke evidence described in ADR-0016.
3. Complete deploy-preview AUTH.1/AUTH.2 smoke: login/recovery/session/logout, authenticated read, CSRF establishment and invalid-token denial, safe paper mutation, viewer denial, tenant denial, and old-session denial.
4. Verify production persistence rollout/backups and production market-data credentials, entitlements, delay flags, and freshness contracts.
5. Run the approved final authenticated production-safe smoke/E2E and collect release evidence.

AUTH.1 changes identity/session runtime behavior and adds `@netlify/identity`; it does not change trading logic, market providers, billing configuration, or database schema.

## AUTH.2 API security update

AUTH.2 adds no identity provider, dependency, database migration, trading/provider/AI/risk behavior, broker path, or paid service. It protects the 26 previously sensitive/plain legacy routes, adds the authenticated CSRF bootstrap Function, centralizes signed-token browser transport, preserves `health` and `watchlist` as documented public reads, and records the compatibility-only status of legacy memory mutations. Deployed Identity email/recovery and authenticated E2E evidence remain pending.

## PI.3 persistence update

PI.3 introduces no live trading, broker, authentication, AI, provider, strategy/scoring/regime/risk formula, database vendor, or paid-service change. It adds only the existing-PostgreSQL transactional paper account, immutable executions, and position projection used by PA.2/PA.4, while PA.3/PA.5 recompute realized analytics from the ledger. Real deployed migration and authenticated lifecycle evidence remain owner actions.

## PI.4 persistence update

PI.4 routes canonical browser portfolio/journal reads to deterministic PI.3 projections, supplies Daily Briefing with durable paper state, and persists scanner/alert definitions in the existing PostgreSQL tables under organization/team/account/user scope. Matches, alert evaluations, briefings, PA.3, and PA.5 remain derived. The old plain-wrapper memory Functions remain compatibility-only pending separately authorized retirement/control work.

The additive PI.4 migration and definition persistence were first verified on the approved local non-production PostgreSQL database with synthetic records. Migration tracking, composite indexes, repository re-instantiation, cleanup, and cross-organization denial passed. The subsequent production rollout and authenticated evidence are recorded below; backups/restores, capacity, and retention execution remain owner-operated verification items.

## RELEASE.1 production closure evidence — 2026-08-14

- GitHub PR #1 was merged to `main`; hosted GitHub Actions passed at merge commit `70f4c768e64c783d4257f849a11a70f98f22a5fe`.
- Netlify production deployed the merged `main` application successfully after production environment validation. `NODE_ENV=production`, `ATLAS_AUTH_MODE=netlify-identity`, `TRADING_MODE=paper`, and the secret Neon pooled `DATABASE_URL` are configured without repository or browser exposure.
- The production Neon database accepted all 71 ordered migrations from zero. `atlas_schema_migrations` contains 71 unique records; PI.3 migration 069 and PI.4 migration 070 are tracked, and an idempotent rerun applied zero migrations.
- The verified Netlify Identity owner is mapped to one active Atlas user, `org-atlas-local`, and one active owner membership. Signed-in tenant-scoped dashboard, Scanner, Orders, Portfolio, Reports, alert, and durable paper-account reads succeed.
- A reversible production-safe alert create/delete verified authenticated CSRF establishment and mutation handling. The synthetic alert was removed. Unauthenticated protected reads, invalid bearer requests, and unauthenticated mutations fail closed with HTTP 401; `health` and `watchlist` remain the two intentional public HTTP 200 reads.
- The canonical durable paper account survives navigation and reports the approved $100,000 initial paper balance. Scanner/opportunity, order/position, portfolio/journal, PA.3 performance, and PA.5 learning surfaces load without tenant denial or unexpected 5xx responses. No live order or broker call was made.
- Deployed market evidence is visibly `MOCK DATA` where mock fallback is active; unavailable portfolio price provenance is labeled `UNKNOWN` and explicitly does not assume live status.
- Production browser review found no console warning/error, authentication loop, authorization loop, redirect loop, bearer/CSRF leakage, unhandled exception, or unexpected 5xx during the verified navigation.
- Local release verification passed all 1,434 tests, lint at 23 warnings against the approved baseline of 26, production build, performance budget, migration-safety scan, sensitive-material scan, generated-artifact check, and API-control inventory freshness check. Cross-platform CRLF normalization protects the CI workflow and inventory freshness assertions on Windows without changing the controlled artifacts.

The remaining operational items do not block v1: production backup/restore execution and retention evidence remain owner-operated and unverified; live-provider credentials/entitlements are not required while the UI explicitly labels mock/unknown evidence; serverless caches and provider budgets remain process-local. The v1.0.0 tag and GitHub release are created only after hosted CI passes at the release-closure commit.
