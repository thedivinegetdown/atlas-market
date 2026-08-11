# Atlas Market Production-Readiness Baseline

Status: authoritative repository baseline for follow-up remediation

Verified: 2026-08-11

Scope: authentication, API controls, persistence, market-data degradation, CI/release gates, and release blockers

This document records source and read-only runtime findings. It does not authorize an identity-provider selection, deployment, provider-plan change, database migration, or trading-behavior change. Atlas remains analysis and paper/simulated execution only.

## Executive conclusion

Atlas has a reachable Netlify deployment, a passing production build, extensive deterministic test coverage, shared API controls, and explicit paper-only trading boundaries. It is not ready to be represented as a complete authenticated production application.

AUTH.1 now supplies an invite-only Netlify Identity browser/session foundation and a fail-closed production verifier. The 28 plain-wrapper Functions remain unchanged, production persistence is unverified and optional, quote fallback can return mock data, CSRF remains presence-only, and CI now enforces the repository's deterministic release gates through the shared release verifier.

## Authentication architecture and browser gap

The shared authenticated Function path is implemented by `netlify/functions/_shared/authApi.js`:

1. extract a bearer token or `atlas_session` cookie;
2. apply an origin allowlist;
3. require an `x-csrf-token` header for authenticated mutations;
4. call the configured authentication adapter;
5. validate session status and expiry;
6. evaluate role permissions;
7. optionally enforce organization and team membership boundaries.

The default adapter in `lib/auth/authenticationProvider.js` is `local-development`. It is explicitly marked `productionSafe: false`. Any supplied bearer value is used to construct a local session, and the default development role is owner. An external provider contract exists, but no production provider is selected or configured in this scope.

The browser client in `src/api/workspaceApiClient.js` sends JSON and a fixed CSRF-presence header for mutations, but it does not send an Authorization header or create/manage an authenticated session. Unit/UI test setup injects a test bearer header, so test success does not prove the production browser flow.

Read-only production checks on 2026-08-11 returned HTTP 200 for the SPA root, `/dashboard`, `/markets`, and the public health Function. An unauthenticated `market-overview?symbol=SPY` request returned HTTP 401. This proves deployment reachability and enforcement at that endpoint, not a working browser sign-in flow.

## API control inventory

The generated [Markdown inventory](../architecture/API_CONTROL_INVENTORY.md) and [JSON inventory](../architecture/api-control-inventory.json) cover every `netlify/functions/*.js` entry point. Regenerate them with `npm run audit:api-controls`; CI checks freshness with `npm run audit:api-controls:check`.

| Wrapper/control | Count | Boundary represented in source |
| --- | ---: | --- |
| Team-authenticated | 8 | Organization and team |
| Organization-authenticated | 216 | Organization |
| Authenticated | 18 | Authenticated user/workspace role |
| Plain shared API | 28 | None |
| Unknown | 0 | N/A |
| **Total** | **270** | |

Method classification is 75 read-only, 56 mutation-only, and 139 mixed read/mutation Functions. Source classification produces 12 P0, eight P1, eight P2, and 242 P3 entries.

### P0 plain-wrapper mutations

These endpoints have shared request validation, error handling, process-local rate limiting, and observability, but no authenticated wrapper, role decision, tenant boundary, or authenticated CSRF check:

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

Paper semantics prevent real brokerage execution, but unauthenticated paper-order and state mutation remain production security defects. Recommended priority: protect paper-order mutations first, then other state mutation, with the narrowest applicable user/organization/team scope and verified CSRF behavior.

### P1 sensitive plain reads

- `journal-summary`
- `operator-actions`
- `orders`
- `portfolio-summary`
- `positions`
- `risk-summary`
- `signals`
- `system-events`

These expose paper trading, operational, portfolio, or decision context without an authenticated wrapper. Recommended priority: require authenticated access and add organization/team scope wherever the data model supports it.

The remaining eight plain reads are P2 until their intentionally-public contract is approved or they are migrated to authenticated wrappers. The inventory records the exact endpoint, path, methods, wrapper, boundary, CSRF classification, risk, priority, and remediation for all Functions.

## Persistence limitations

Atlas uses server-side `pg`, code-managed migrations, and repository abstractions. `DATABASE_URL` is optional. When absent, the PostgreSQL adapter reports disabled/degraded persistence and returns non-durable fallback results. Several core trading repositories use process-memory state, which is not durable or consistent across serverless instances.

The repository contains no Supabase SDK, Supabase Auth, Realtime, Storage, or vendor-specific integration. A Supabase-hosted PostgreSQL URL is compatible in principle but is not a verified Supabase integration.

Production readiness requires external evidence for the database host, credentials, pooling/capacity, migration ownership, tenant-scoped query behavior, backups, restore testing, retention, and recovery objectives. No schema change is authorized by this baseline.

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
3. Twelve plain-wrapper mutation endpoints include paper-order and state-changing operations.
4. Eight sensitive paper/portfolio/operational reads use the plain wrapper.
5. CSRF control verifies header presence rather than a server-bound token value.
6. Durable production persistence, pooling, tenant isolation, backup, restore, and retention are unverified.
7. MD.1 now makes live, delayed, stale, degraded, mock, unavailable, and unknown provenance explicit in the principal market workspaces; production provider entitlement, delay, and freshness evidence remains unverified.
8. CI gates are deterministic repository checks and do not replace deployed authenticated smoke/E2E evidence.
9. No repeatable authenticated production smoke/E2E evidence exists.
10. Documentation must avoid treating deterministic engines and tests as proof of production integration.

## Remediation order

1. Review and accept this baseline and generated inventory.
2. Complete the Netlify Identity manual setup and production smoke evidence described in ADR-0016.
3. Implement AUTH.2 origin/CSRF hardening without weakening bearer verification.
4. Protect P0 paper-order mutations, then the remaining P0 state mutations.
5. Protect P1 sensitive reads and establish tenant scope.
6. Approve or protect the P2 intentionally-public candidates.
7. Verify production persistence and production market-data credentials, entitlements, delay flags, and operational freshness contracts.
8. Add authenticated read-only production smoke/E2E coverage after AUTH.1 is operationally unblocked.

AUTH.1 changes identity/session runtime behavior and adds `@netlify/identity`; it does not change trading logic, market providers, billing configuration, or database schema.
