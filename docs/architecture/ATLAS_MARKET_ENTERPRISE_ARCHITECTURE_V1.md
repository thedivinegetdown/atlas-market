# Atlas Market Enterprise Architecture v1.0

Status: Baseline
Effective date: 2026-07-27
Source of truth: repository at the v1.0.0 baseline
Scope: architecture that is implemented or explicitly constrained in this repository

## 1. Product vision

Atlas Market is a production-deployed, paper-trading workspace for market research, portfolio and risk review, strategy analysis, simulated execution, operational review, and bounded AI-assisted decision support. It is intentionally not a brokerage, an autonomous trading agent, or a source of financial advice. Its durable product boundary is human-reviewed analysis plus simulated, non-monetary execution.

The platform should evolve by strengthening the implemented modular system, its evidence, and its operational controls. Working contracts are preferred over redesign. Live order routing and AI-directed execution remain excluded unless separately approved through architecture governance.

## 2. Evidence and architecture status

This baseline was derived from `README.md`, `package.json`, `netlify.toml`, `.env.example`, `.github/workflows/ci.yml`, `src/`, `lib/`, `netlify/functions/`, `tests/`, `scripts/release-verify.mjs`, and the existing release and architecture documentation.

The repository contains both user-facing runtime paths and a large set of deterministic engines, APIs, tests, readiness models, and governance models. File presence and unit coverage demonstrate implemented contracts; they do not by themselves prove that every engine is invoked by the production UI, backed by a configured production database, or connected to an external service. This document distinguishes those states where material.

## 3. System context

```text
Human operator
  -> Netlify-hosted React/Vite SPA
     -> /.netlify/functions/*
        -> deterministic domain and governance engines
        -> PostgreSQL through pg (optional when DATABASE_URL is absent)
        -> market-data providers (Finnhub, Twelve Data, mock/fallback)
        -> configured AI provider gateway (advisory output only)

GitHub -> CI (test and build)
main branch -> Netlify build -> dist + serverless functions
```

External actors and systems are the human operator, Netlify, GitHub Actions, configured PostgreSQL, market-data services, and an AI provider where configured. No live broker is part of the system context.

## 4. Architectural principles

1. Paper trading is a hard execution boundary, not merely a UI label.
2. AI is advisory, bounded, human-reviewed, and disconnected from execution authority.
3. Deterministic validation and risk controls take precedence over provider output.
4. Workspaces own presentation; shared runtime and domain behavior remain reusable.
5. Serverless functions form the browser-to-server boundary.
6. External providers are replaceable, normalized, observable, and degradable.
7. Persistence is accessed through repositories rather than embedded SQL in UI code.
8. Tenant and authorization context must be enforced server-side for protected resources.
9. Secrets remain outside source control and browser-visible configuration.
10. Releases are evidence-based: tests, lint, build, performance, safety scans, and review.
11. New work extends documented contracts incrementally and records material decisions in ADRs.

## 5. Subsystem boundaries

| Subsystem | Primary location | Responsibility | Boundary notes |
| --- | --- | --- | --- |
| Workspace UI | `src/workspaces/`, `src/components/` | Route-owned views, composition, operator interaction | Presentation only; should not own server secrets or live execution |
| Client runtime | `src/hooks/`, `src/api/` | UI state orchestration and calls to functions | Uses `/.netlify/functions`; some deterministic engines are also imported client-side |
| Domain engines | `lib/`, `src/core/` | Market, signals, risk, simulated execution, accounting, analytics, strategy, governance | Mostly deterministic modules with injectable collaborators and event emission |
| API boundary | `netlify/functions/` | HTTP validation, authorization, orchestration, response contracts | Many thin function entry points share API/auth/persistence helpers |
| Persistence | `lib/db/`, `lib/repositories/` | PostgreSQL client, idempotent migrations, document/store repositories | `DATABASE_URL` is optional in some readiness paths; no Supabase SDK exists |
| Market data | `lib/market/`, `lib/scanners/` | Provider contracts, normalization, polling/streaming, caching, resilience and failover | Finnhub, Twelve Data and mock behavior are represented |
| Paper trading | `lib/broker/`, `lib/orders/`, `lib/trading/`, `src/core/execution/`, `src/core/accounting/` | Validation, simulation, order lifecycle, reconciliation and reporting | No live-broker adapter or real-money route is present |
| Risk | `lib/risk/`, `src/core/risk/` | Limits, sizing, drawdown and trade guardrails | Deterministic veto/assessment layer for paper workflows |
| AI and research | `lib/ai/`, `lib/research/`, `src/core/ai/`, AI functions | Context construction, provider routing, safety evaluation, explanations and insights | Advisory only; output is untrusted until validated |
| Identity/governance | `lib/auth/`, `lib/security/`, `lib/system/` | Identity, tenant access, administration, compliance and operational readiness models | Broad modeled surface; deployment and UI integration vary by capability |
| Observability/release | `lib/logging/`, `lib/observability/`, release engines, `scripts/` | Structured/redacted events, health, diagnostics, release evidence | Console/serverless-log oriented; external telemetry backend is not established |

## 6. Trust boundaries

1. **Browser to Netlify Functions.** Browser input is untrusted. Function handlers must enforce method, body/query validation, permissions, origin policy, rate limits where applicable, and safe error serialization.
2. **Function runtime to secrets and environment.** `DATABASE_URL`, provider credentials, and deployment tokens are trusted runtime configuration. `VITE_*` variables are browser-exposed by design and must never contain confidential values. The current `.env.example` lists market-provider keys with `VITE_` prefixes; that is a documented risk requiring review.
3. **Function runtime to PostgreSQL.** Database responses are tenant-scoped application data. Parameterized access and repository boundaries are required; connectivity does not imply authorization.
4. **Platform to market-data providers.** Provider payloads, timestamps, availability, and symbol formats are untrusted until contract validation, normalization, and freshness checks complete.
5. **Platform to AI providers.** Prompts and responses cross an external-provider boundary. Responses cannot authorize trades, change risk limits, or bypass deterministic rules.
6. **Tenant to tenant.** Organization and team-workspace identifiers form a data-isolation boundary enforced in server-side auth and repository queries.
7. **Source control to deployment.** Reviewed code and configuration cross into CI and Netlify. Secrets and generated artifacts must remain outside commits.
8. **Operator to simulated execution.** Human intent is still validated; the operator cannot turn a paper order path into a live order through request data or environment drift.

## 7. Frontend architecture

`src/main.jsx` mounts React. `src/App.jsx` selects `BrowserRouter` in the browser and `MemoryRouter` outside it. `src/AppRoutes.jsx` defines a persistent `WorkspaceLayout` and lazy imports fourteen workspace routes. `/` aliases Dashboard and unknown routes redirect to `/`.

`WorkspaceLayout` owns permanent navigation, breadcrumbs, responsive shell behavior, suspense fallback, and route error containment. `src/workspaces/<Workspace>/` owns each workspace entry, composition component, and local presentation sections. Shared panels and workspace primitives remain under `src/components/`. This prevents the application bootstrap from becoming the workspace runtime and gives routes independent production chunks.

Hooks orchestrate user-facing data. `src/api/workspaceApiClient.js` centralizes browser calls to `/.netlify/functions`. Some pure engines under `src/core/` and `lib/` are bundled client-side for deterministic analysis. This dual-runtime reuse is useful but creates a boundary risk: server-only modules and secrets must never enter browser import graphs.

There is no general client state framework. State is local React/hook state plus API results and the in-process event bus. The repository does not establish durable browser persistence as a primary data store.

## 8. Runtime architecture

Atlas has three runtime shapes:

- **Static SPA:** Vite compiles React and route chunks to `dist`, served by Netlify.
- **Serverless API:** individual files in `netlify/functions/` become independently invoked functions. Shared wrappers in `_shared/` provide API, auth, and persistence behavior.
- **Deterministic module runtime:** `lib/` and `src/core/` engines execute in browser, functions, tests, or operational models depending on their imports.

The function architecture favors small endpoint adapters over a monolithic server. This fits Netlify deployment but makes cross-cutting consistency—authentication, rate limiting, logging, error handling, and cold-start/database lifecycle—an architectural concern. Background-like report worker and streaming/session behaviors are expressed as functions and engines; the repository does not establish a continuously running application server.

## 9. Provider architecture

Market data uses explicit contracts and normalization. `providerContract.js`, `marketDataAdapter.js`, and `marketNormalizer.js` define consistent behavior; `providerRegistry.js` selects registered providers; Finnhub and Twelve Data clients represent external integrations; `mockMarketDataProvider.js` supports deterministic and degraded operation.

`marketDataService.js` coordinates quote/history access and diagnostics. Cache, freshness/gap recovery, polling/streaming, WebSocket adaptation, provider resilience, and failover are separate engines under `lib/market/`. Provider errors are not allowed to redefine trading semantics. Fallback must preserve provenance and health/degraded status, avoid silently presenting stale data as current, and never bypass validation.

The architecture supports multiple providers, but configured credentials, service entitlements, and true production streaming behavior are deployment facts outside source evidence.

## 10. Trading architecture

Orders flow through request validation, order-domain validation, risk checks, simulated broker/execution behavior, state transitions, portfolio accounting/reconciliation, journal/reporting, and event emission. Core responsibilities are separated across `lib/orders/`, `lib/risk/`, `lib/broker/`, `lib/trading/`, `lib/portfolio/`, `src/core/execution/`, and `src/core/accounting/`.

The event bus is an in-process coordination contract, not a durable message broker. Events aid decoupling and tests but do not provide cross-instance delivery, replay durability, or exactly-once guarantees.

### Paper-trading boundaries

- `TRADING_MODE` validates to paper behavior, and release validation forces paper-only configuration.
- Paper broker and execution simulator components produce simulated fills and lifecycle states.
- APIs and operational outputs repeatedly assert `paperTrading: true`, `liveOrders: false`, and `brokerExecution: false`.
- No live broker connectivity or live order routing is present.
- AI recommendations cannot submit, approve, size, or execute an order.
- Any proposal to introduce brokerage connectivity, real funds, autonomous action, or relaxed risk vetoes requires an approved ADR and a new security/compliance architecture review.

## 11. AI architecture

Atlas AI is layered: research and portfolio engines build deterministic context; the AI gateway selects/configures provider interaction; decision orchestration and Copilot engines shape advisory explanations, conversations, opportunity analysis, and portfolio insights; Netlify Functions expose server-side endpoints; React panels present results and limitations.

AI output is treated as untrusted. Deterministic validation, risk guardrails, paper-only flags, prompt/response safety rules, and human review remain authoritative. Provider failure should degrade optional AI surfaces without disabling deterministic portfolio, risk, market, or paper-order workflows. Provider credentials belong server-side; raw prompts, provider payloads, hidden reasoning, secrets, and tenant-sensitive data must not enter logs or public diagnostics.

## 12. Persistence

The implemented persistence boundary is PostgreSQL via the `pg` dependency. `lib/db/pgClient.js` owns connection behavior; `persistenceService.js` owns initialization; `migrations.js` contains additive/idempotent schema creation; `postgresRepository.js` and domain repositories own data access. Document-store abstractions provide structured payload storage patterns.

`DATABASE_URL` supplies connectivity. When it is absent, selected readiness and service paths report disabled/degraded persistence rather than proving durable storage. The repository contains no Supabase client dependency, auth integration, or vendor-specific API. A Supabase-hosted PostgreSQL URL is compatible in principle, so “Supabase boundary” presently means an external managed-Postgres deployment option behind the generic PostgreSQL contract, not a verified Supabase integration.

Tenant-aware repositories must include organization/team-workspace scope in queries. Migrations are code-managed and scanned for destructive statements by release verification. Backup, restore, retention, and production connection-pooling arrangements are modeled/readiness concerns but are not fully evidenced as externally operated services.

## 13. Data flow

### Read path

1. A routed workspace mounts and a hook requests data.
2. The API client calls a Netlify Function.
3. Shared handler code assigns request context and applies validation/auth controls.
4. The function invokes a domain service, provider adapter, or repository.
5. External/provider data is validated and normalized; persisted data is tenant-scoped.
6. A safe JSON response returns to the hook and is rendered by workspace-owned presentation.

### Paper order path

1. The operator submits paper-order intent.
2. Server-side validation normalizes the request and rejects invalid/live semantics.
3. Risk limits and guardrails evaluate the intent.
4. Paper broker/execution simulation creates simulated order/fill state.
5. Portfolio, position, accounting, journal, reporting, and events update through their contracts.
6. The UI displays the simulated result and paper-only disclosure.

### AI path

1. The operator requests analysis.
2. Atlas assembles bounded portfolio/research context.
3. A server-side gateway invokes the configured provider where available.
4. Safety and deterministic policy constrain/validate the result.
5. The response is labeled advisory and returned for human review; no execution edge follows.

## 14. Security model

The shared API layer supplies safe response/error contracts and request IDs. Netlify Identity owns production credential/session proof; the browser root handles invite/login/logout/restoration and the central API client sends the current access token. The production adapter verifies the session with Netlify and cannot fall back to local development authentication. Atlas auth modules remain authoritative for permissions, organization/team membership, and tenant isolation; verified users without an explicit safe role default-deny. Security modules provide request guards, policy evaluation, and rate limiting. Database access is parameterized through repositories. Logging recursively redacts sensitive key names and PostgreSQL URLs.

Security invariants are server enforcement, least privilege, tenant-scoped access, safe identifiers/payloads, secret-free source and diagnostics, paper-only execution, and no trust in provider output. Browser code is public. Consequently, `VITE_*` values cannot be treated as secrets. The current market-provider variable naming should be resolved by either formally accepting public client keys with constrained provider privileges or moving confidential provider calls behind Functions.

The repository provides deterministic Identity adapter and browser-flow tests, but it does not prove deployed invite-only configuration, first-owner provisioning, production callbacks/refresh, WAF policy, centralized secret rotation, penetration testing, or continuous vulnerability scanning. Presence-only CSRF is explicitly deferred to AUTH.2.

## 15. Observability

`lib/logging/logger.js` emits structured JSON with configurable levels and redaction. `eventLogger.js` records trading-domain events with request identifiers. Readiness checks cover environment, database, market provider, and paper mode. Client logging, System Health, release diagnostics, provider-health engines, paper-operations observability, and release evidence models create review surfaces.

Current observability is primarily application events, health responses, tests, and Netlify/runtime logs. No repository evidence establishes a centralized metrics, tracing, alert-routing, SLO, or long-term log-retention backend. Correlation IDs, consistent endpoint instrumentation, production dashboards, alert ownership, and data-retention policy are incremental priorities.

## 16. Testing strategy

Vitest with jsdom covers pure domain engines, repositories, functions, hooks/components, routing, accessibility/security hardening, responsive workspaces, provider reliability, paper workflows, AI boundaries, persistence, release readiness, and bundle performance. Tests are colocated in `src/` and `lib/` and concentrated in the phase-oriented `tests/` suite.

The validation pyramid is:

- deterministic unit tests for engines and validators;
- contract/integration tests for repositories and Netlify handlers;
- component/workspace tests for user behavior and boundaries;
- build and bundle/performance verification;
- release safety scans and operator smoke checks.

CI currently runs `npm run test:ci` and `npm run build` on pull requests and pushes to `main`. Local `npm run release:verify` is broader: focused security/release tests, full tests, lint with a warning baseline, build, performance budget, migration safety, sensitive-material scan, generated-artifact check, and git-state reporting. Browser-based production smoke automation remains roadmap work.

## 17. Deployment architecture

`netlify.toml` builds with `npm run build`, publishes `dist`, and packages `netlify/functions`. A `/* -> /index.html` status-200 redirect enables React Router direct navigation and refresh. Local integrated development uses `netlify dev`; Vite alone serves frontend development.

GitHub Actions uses Node 22, `npm ci`, tests, and production build. Repository documentation states that `main` deploys to Netlify, but the Netlify linkage and environment configuration are external state. The SPA and functions share an origin in the intended deployment, simplifying client API paths.

## 18. Release strategy

The current release unit is a reviewed main-branch revision that passes CI and the broader local release verification. Release documentation and operator checklists record scope, exclusions, evidence, rollback/readiness posture, route refresh, and paper/advisory boundaries. Generated `dist`, `.netlify`, secrets, tags, and GitHub releases are not required artifacts of a normal implementation order.

Future work follows [Atlas Market Engineering Process](../process/ATLAS_MARKET_ENGINEERING_PROCESS.md): architecture, roadmap, focused execution order, implementation, one validation cycle, one commit, one push, architecture review, then the next sprint.

## 19. Scalability considerations

- Route lazy loading and explicit Vite chunk groups reduce initial client cost; budgets must evolve with measured use.
- Serverless functions scale independently but can amplify cold starts, connection counts, and duplicated initialization.
- Direct `pg` connections from many function instances require a production pooling strategy appropriate to the PostgreSQL host.
- In-memory event bus, cache, rate limiter, streaming session, and mock/store state do not coordinate across instances; distributed requirements need explicit durable infrastructure.
- Provider quotas, freshness, backpressure, failover, and streaming fan-out must be capacity-tested rather than inferred from unit behavior.
- Tenant-scoped payload/document tables require indexing, retention, and query-volume review as data grows.
- The large number of function entry points and system engines raises ownership and regression cost; capability inventories and contract checks should precede consolidation.

## 20. Known architectural risks

| Risk | Impact | Incremental response |
| --- | --- | --- |
| Runtime integration is uneven across a very broad modeled surface | Documentation or operators may overstate production capability | Maintain a capability/runtime matrix and mark UI/API/database/provider deployment evidence |
| Provider quotas are process-external while cache, deduplication, and budgets are process-local | Concurrent Functions can collectively exceed a provider allowance | Keep conservative per-process ceilings, honor provider backoff, monitor usage, and adopt durable coordination only if scale requires it |
| Direct serverless PostgreSQL connections | Connection exhaustion and cold-start latency | Document and validate managed pooling before load growth |
| In-memory coordination primitives | State inconsistency across function instances | Keep their guarantees explicit; introduce durable coordination only for proven needs |
| Numerous thin functions and repositories | Cross-cutting controls can drift | Add automated endpoint/control inventory and shared-handler conformance tests |
| Observability lacks evidenced centralized telemetry/SLOs | Slow incident detection and weak trend analysis | Define critical journeys, service indicators, alert ownership, and retention |
| Production configuration is external to the repository | Deployment claims can diverge from code | Capture environment/deployment evidence without secrets during release review |
| Migration set is large and application-managed | Operational migration and rollback risk | Add staging rehearsal, schema ledger, backup/restore evidence, and compatibility windows |
| CI is narrower than `release:verify` | Main may pass CI without full release gates | Incrementally align CI after measuring duration and stability |
| AI/provider contracts can drift | Unsafe, misleading, or unavailable analysis | Version provider contracts, retain deterministic evaluation, and test degraded modes |

## 21. Future extension points

- Provider adapters registered behind existing market-data contracts.
- Alternative advisory AI providers behind the gateway and safety policy.
- Durable distributed cache/event/stream coordination when multi-instance requirements are demonstrated.
- Managed PostgreSQL operational hardening, including pooling, backups, recovery tests, and retention.
- Centralized metrics, traces, security monitoring, and release evidence export.
- Workspace presentation modules and selectors added without expanding bootstrap ownership.
- Versioned API contracts and generated endpoint inventory.
- Enterprise identity-provider integration behind current authentication/authorization abstractions.

Live brokerage execution, autonomous AI action, and financial advice are not ordinary extension points. They are changes to the product's trust and safety model and require a separately approved architecture decision.

## 22. Related architecture records

See the [ADR index](../adr/README.md) for the decisions embodied by this baseline and the [implementation roadmap](../roadmap/ATLAS_MARKET_IMPLEMENTATION_ROADMAP_V1.md) for incremental follow-through.
