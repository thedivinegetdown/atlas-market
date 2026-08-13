# Atlas Market paper workflow persistence gap analysis

Status: PI.4 production paper workflow persistence integration implemented
PI.2 baseline: `02862dfe29788fc4eff5e2625bdb16de5fc03e02`
Review date: 2026-08-11

## Decision

PI.4 closes the repository-level gaps identified here: canonical portfolio and journal reads derive from PI.3, PA.3/PA.5 remain deterministic ledger consumers, Daily Briefing receives durable paper state, and scanner/alert definitions use tenant-scoped PostgreSQL storage. Legacy plain-wrapper memory Functions remain compatibility-only and deployed production verification remains an owner action. See [PI.4 durable paper workflow integration](./DURABLE_PAPER_WORKFLOW_INTEGRATION.md).

Atlas's current paper workflow is not persistence-complete enough to trust across Netlify Function cold starts, separate Function instances, process restarts, or deployments.

The smallest reliable design is not to persist every output. It is to make four source-of-truth groups durable in the existing PostgreSQL architecture:

1. reviewed opportunity and PA.1 evaluation evidence;
2. immutable/idempotent PA.2 paper execution records;
3. one canonical paper account and its positions/cost basis;
4. PA.4 exit executions, realized P&L, and entry/exit linkage.

Paper Performance, Paper Learning, Daily Briefing, scanner matches, Trade Quality calculations, and most portfolio metrics should be recomputed from those durable sources plus fresh market data.

PI.1 made no runtime, schema, provider, authentication, AI, risk, or trading change. PI.2 implements only the first two durable source-of-truth groups above: reviewed opportunity/PA.1 evidence and append-safe PA.2 execution-intent evidence.

## PI.2 canonical workflow closure

The production intelligence workflow is now explicitly:

**Reviewed Opportunity → PA.1 Controlled Paper Evaluation → PA.2 Guarded Paper Simulation → PI.3 transactional account/execution/position ledger → PA.4 reduction/close → PA.3/PA.5 deterministic analytics**

An eligible Trade Quality review is sent from the browser to the authenticated `opportunity-intelligence` mutation. That Function, `paper-evaluation`, and `paper-order-simulation` all resolve the same DB.1 PostgreSQL repository supplied by the authenticated persistence wrapper. A disconnected repository returns the stable 503 code `durable_paper_evidence_unavailable`; production never accepts these records into an implicit memory fallback. Test/development memory repositories must be explicitly injected and are rejected when marked as memory in production.

The existing `atlas_ai_opportunity_analysis_history` table remains the durable evidence source. Records retain organization, nullable team, account, and user scope. Tenant-scoped SHA-256 record ids plus `ON CONFLICT` enforce idempotency across cold starts, instances, deployments, and retries without a schema change. Reviewed TQ snapshots carry a deterministic compact-evidence fingerprint; PA.1 includes it in its evaluation fingerprint; PA.2 stores the PA.1 evidence fingerprint with the proposed plan, guardrail outcome, status, and version metadata. Raw candles, provider payloads, credentials, and prompts are excluded.

Legacy `submit-paper-order` and the process-memory order/portfolio/journal repositories remain compatibility-only. PI.3 now supplies PA.2 with the canonical durable account and positions, transactionally commits the immutable entry plus account and position projection, and makes PA.4 transactionally commit reductions/closes and realized P&L. PA.3/PA.5 recompute from realized immutable executions. The legacy position aggregate is no longer called by the canonical path.

No migration, dependency, database vendor, live broker, account mutation repository, authentication, scoring, strategy, risk-formula, AI, or provider change was added by PI.2.

## Scope and classification

This review followed only the workflow named in PI.1 and the overlapping legacy paper-order/accounting path exposed by the current UI. It did not re-audit unrelated repositories.

| Priority | Meaning |
| --- | --- |
| P0 | Must be durable and transactionally safe before the production paper workflow can be trusted |
| P1 | Should be durable for reliable configuration, operator history, or audit continuity |
| P2 | Deterministically recomputable or acceptable as explicit ephemeral state |
| P3 | Development/test-only state that must not be treated as production evidence |

“Durable-capable” below means SQL exists, not that the deployed database or Function wiring has been verified.

## End-to-end workflow state map

| Stage | State created or consumed | Current storage/mechanism | Cold start, deployment, or different instance | Recovery and loss consequence | Priority / recommended source |
| --- | --- | --- | --- | --- | --- |
| Market data | Quotes, historical candles, provenance, regime inputs | Provider response plus process-local historical cache, in-flight map, and request budget | Cache/budget resets; another instance has independent state | Refetch when providers are available; fail closed for unavailable historical candles; no paper history should depend on cache survival | P2; refetch with provenance, do not make cache the trade ledger |
| Watchlist | Fixed symbols used for quote retrieval | Code constant in `marketDataService` | Recreated identically | No state loss; quotes refetch | P2; code/config source is sufficient until users can customize it |
| Scanner definition | User-created rules and enabled state | Legacy `scannerRepository` arrays in `lib/repositories/store.js` | Lost on cold start/redeploy and not shared between scanner Functions | Scanner cannot reproduce the user's configured discovery workflow | P1; reuse the existing `atlas_realtime_scanner_subscriptions` SQL contract after choosing team/user ownership |
| Scanner match | Evaluated symbols, signals, risks, match reasons | Computed from scanner rules and current market data | Lost immediately | Re-run scanner from durable definition and fresh market data | P2; recompute, optionally retain bounded audit evidence only if later required |
| Alerts | Alert definitions, lifecycle, trigger results | Legacy alert arrays; a separate `atlas_realtime_alerts` durable-capable repository also exists but is not the legacy UI path | Legacy definitions and trigger history disappear or diverge across Functions | Does not corrupt paper accounting, but users can miss expected monitoring | P1 for definitions/lifecycle; trigger display can be derived or retained as bounded history |
| Trade Quality | Deterministic score, band, evidence coverage, blockers, market provenance | Raw calculation remains browser/recomputable; eligible explicit review is posted to durable history | Raw calculation can be recomputed; the accepted compact snapshot survives when DB.1 is connected | Exact reviewed evidence and its fingerprint are available to PA.1; ineligible/unknown-strategy results are not persisted as eligible | P2 raw computation; PI.2 closes the P0 reviewed-evidence handoff |
| Opportunity review | Human-reviewed Trade Quality snapshot and review state | Canonical DB.1 adapter + `atlas_ai_opportunity_analysis_history` | Tenant-scoped record survives cold starts, instances, and deployments; disconnected storage returns 503 | PA.1 reads the same compact durable source; raw candles/provider/prompt data are excluded | P0 evidence handoff implemented in PI.2; deployed DB proof pending |
| PA.1 Paper Evaluation | Evaluation id, evidence fingerprint, approval/watch/reject status, strategy/regime/risk snapshot | Canonical DB.1 adapter + `paper_evaluation` history record | Scoped id + database conflict suppress unchanged evidence after restart/retry | PA.2 reads the durable evaluation and linkage; changed evidence produces a new record | P0 evaluation evidence implemented in PI.2; deployed DB proof pending |
| PA.2 Paper Order Simulation | Evaluation-linked plan, guardrail result, simulation status, fingerprint, and versions | Canonical DB.1 adapter + append-safe `paper_simulation` intent/audit record | Scoped id + database conflict suppress duplicate intent and prevents repeated position projection | Intent/audit survives; account/position accounting continuity still awaits PI.3 | P0 intent evidence implemented in PI.2; PI.3 owns ledger/account/positions |
| PA.2 account input | Cash, equity, buying power, drawdown/risk summary used for sizing/guardrails | `getPortfolioSummary()` reads process-local order/portfolio/journal arrays or defaults to a new $100,000 account | Resets to defaults; separate instances see different accounts | Position sizing and buying-power decisions can use an incorrect account | P0; one durable account row/ledger per organization, team, account, and owner |
| PA.3 Paper Position | Quantity, side, average price/cost basis, originating evaluation/candidate, strategy | Generic `atlas_operator_actions` record through `paperPositionStore`; durable-capable with DB.1 configuration, but deployed execution is unverified | Survives only when PostgreSQL is configured and reachable; otherwise save is disabled | Without the row Atlas forgets the open position and cannot perform PA.4 exit | P0; dedicated/account-queryable position projection or a strengthened canonical paper store |
| PA.3 multi-position account continuity | Cash/account snapshot after entry | Embedded separately inside each paper-position aggregate | Each position carries its own account snapshot; PA.2 simulates every selected evaluation against the same starting portfolio | Even without restart, multiple fills can produce mutually inconsistent cash/equity snapshots | P0; update one canonical account in the same transaction as execution and position |
| PA.4 Partial/full Paper Exit | Exit fingerprint, quantity, price, fees, slippage, remaining position, journal evidence | Entire position aggregate is overwritten in `atlas_operator_actions`; exit array is embedded and capped at 100 | Durable only if the generic store is live; list is capped at 100 aggregate rows | Missing/hidden position prevents exit; lost exit array weakens replay protection and linkage | P0; transactional exit execution plus account/position update |
| Realized P&L | Per-exit realized P&L delta and updated account snapshot | Embedded in the PA.4 exit object and position aggregate; legacy journal/account path is separate memory | Lost with aggregate; no global account total exists across positions | Breaks accounting continuity, performance evidence, and reconciliation | P0; immutable execution/ledger record and canonical account balance |
| Entry/exit linkage | Candidate, evaluation, position, simulation fingerprint, exit fingerprint | Spread across AI history payloads and the generic position aggregate | AI history is currently disconnected; generic position can survive independently | PA.3/PA.5 evidence becomes incomplete; orphaned position or unexplained execution possible | P0; durable foreign identifiers and transactionally committed execution/position records |
| Journal | Legacy fill messages/notes; PA.4 journal evidence | Legacy `journalRepository` array; PA.4 embeds a small journal object in exit history | Legacy journal disappears; PA.4 evidence survives only with the aggregate | UX/audit history is incomplete; realized P&L must not depend on the legacy journal | P1 for mutable notes/operator journal; deterministic trade journal should be projected from P0 executions |
| Paper Performance Review | Win/loss, expectancy, drawdown, strategy/regime groupings | Recomputed on each request from PA.2 simulations plus PA.4 exits | Output disappears but can be rebuilt if source records survive | If sources are missing, PA.5 metrics are incomplete or misleading | P2 output; recompute from the durable execution/exit ledger |
| Paper Learning Evidence | Deterministic conclusions and evidence coverage from performance review | Recomputed on each request | Output disappears | Rebuild safely from complete performance sources; otherwise evidence is invalid | P2 output; do not persist as a second source of truth |
| Daily Briefing | Market/regime/strategy context plus reviewed opportunities/evaluations, legacy portfolio and alerts | Recomputed from providers and repositories | Recomputed, but currently loses opportunity/evaluation context and legacy portfolio/alerts | Briefing can degrade to incomplete context; no accounting state should be authored by it | P2 output; durable reviewed evidence/account sources, fresh market inputs |
| Strategy runtime configuration | Current adaptive strategy records and suitability thresholds | Versioned code constants | Recreated identically | No loss for the current product; a future user override would be lost unless separately stored | P2 now; P1 only when editable team/account overrides become a supported feature |

## Priority decision summary

### P0 — required before trusted paper production

- Explicit reviewed-opportunity record and PA.1 evaluation evidence used by the order gate. **Implemented by PI.2; deployed DB verification pending.**
- Canonical PA.2 execution-intent/audit record with a durable uniqueness fingerprint. **Implemented by PI.2; accounting execution remains PI.3.**
- One paper account source for cash, equity/buying power, and cumulative realized P&L.
- Account-scoped open/closed positions with quantity, side, and cost basis.
- PA.4 exit executions, realized P&L, and immutable entry/evaluation/position/exit linkage.
- Transactional/idempotent application of every accepted entry and exit.
- The legacy paper order, portfolio, and journal stores if the owner elects to keep that path; otherwise retire or route them to the canonical PA.2 ledger.

### P1 — reliable configuration and operator history

- Scanner definitions and enabled state.
- Alert definitions and lifecycle/acknowledgement state.
- Mutable human journal notes or annotations, if supported.
- Longer-lived opportunity review history beyond the exact P0 gate records.
- Future editable strategy overrides; current code-defined strategy configuration is P2.

### P2 — recomputable or intentionally ephemeral

- Market quotes/candles caches, in-flight requests, and provider budgets.
- Fixed watchlist and versioned strategy records.
- Scanner matches, signals, regime, strategy suitability, and raw Trade Quality calculations.
- Portfolio metrics/equity curve projected from the P0 ledger/account/positions.
- Journal trade rows, Paper Performance, Paper Learning, and Daily Briefing outputs.

### P3 — development/test only

No P3 store is part of the intended production workflow. Injected test repositories, fixtures, 'resetStore()' state, and test-only candidate arrays are P3 evidence and must never be used to claim production durability. The runtime mock market-data fallback is not P3; MD.1 treats it as explicit degraded/mock P2 input that cannot masquerade as live evidence.

## Current path discontinuities

### Browser-to-PA.1 handoff

PI.2 closes this gap for eligible reviewed results. The browser passes compact opportunity and strategy identity into Trade Quality and submits an eligible result through `opportunity-intelligence` with review state `reviewed`. Results without a score or valid strategy identity remain visible but are not represented as eligible durable PA.1 evidence.

### Disconnected SQL-capable repositories

PI.2 closes this gap for the canonical opportunity-review, PA.1, and PA.2 Functions by exposing the DB.1 repository's parameterized query path and supplying that same pooled adapter to the AI history repository. Other SQL-capable scanner, alert, release, and legacy repositories remain outside PI.2 and schema presence alone still does not establish their runtime durability.

### Competing paper-order paths

Atlas exposes both:

- legacy `submit-paper-order`, which writes process-local order, portfolio, and journal arrays; and
- guarded PA.2 `paper-order-simulation`, which writes AI simulation history and a generic paper-position aggregate.

PI.2 adopts guarded PA.2 as the canonical intelligence workflow because it carries durable evaluation, risk, and evidence fingerprints. The legacy path remains compatibility-only and must not be described as production truth. PI.3 must route or retire it when the canonical account/execution/position ledger is introduced.

## Cold-start and deployment failure risks

Netlify Functions are independent serverless execution units. Module-level arrays can survive some warm invocations of one Function instance, but they are not shared reliably with another Function, another warm instance, or another Function bundle.

Consequently Atlas can currently:

- create a scanner or alert that a subsequent list/evaluate request cannot see;
- accept a legacy paper order and later report no order, position, portfolio change, or journal;
- reset legacy cash to $100,000 and reconstruct no prior fills after a restart;
- forget opportunity reviews, PA.1 evaluations, and PA.2 simulations because their SQL repository is disconnected;
- reset PA.2 daily-count and duplicate history;
- retain a generic paper position while losing the PA.2 simulation record that explains it;
- lose an open position entirely when the generic PostgreSQL store is disabled/unavailable;
- hide an older open aggregate when the fixed 100-row scoped list is saturated;
- recompute performance, learning, and briefing from incomplete sources without a durable completeness checkpoint.

## Accounting continuity findings

### Open position and cost basis

PA.3 keeps quantity and average price inside a paper-position aggregate. This is the only current path that can preserve cost basis across restarts, and only when the DB.1 PostgreSQL adapter is actually configured. Loss or omission of the aggregate makes PA.4 return `paper_position_not_found`, preventing a normal exit.

### Cash and account state

There is no canonical durable paper account. PA.2 starts from the legacy process-local summary/default. Each simulated entry stores its resulting account snapshot inside its own position. Multiple simulations in one PA.2 call all receive the same initial portfolio rather than a successively updated account. PA.4 then exits against the account snapshot attached to that one position, not a shared account.

This can fragment cash, equity, buying power, and realized P&L even before a process restart. A trusted paper workflow requires one serialized account update boundary.

### Realized P&L and journal

PA.4 records a realized P&L delta, exit/account snapshots, and a bounded journal fragment inside the position aggregate. The legacy Journal workspace reads a different process-local collection and therefore is not the PA.4 accounting record.

Realized P&L must be an immutable part of the durable execution ledger. The Journal UI and performance analytics should project from that ledger; journal notes may be stored separately as P1 metadata.

## Duplicate-prevention findings

- PA.1 reuses an evaluation by `evidenceFingerprint`, but the existing-evaluation list is empty when the repository is disconnected.
- PA.2 suppresses fingerprints found in `existingSimulations`, but the default repository returns none and the durable query is capped at the newest 50 rows.
- The SQL simulation id is derived from the fingerprint and uses `ON CONFLICT DO NOTHING`, which can be a durable last-line idempotency control only after the repository is wired.
- PA.2 currently saves the simulation and paper position in separate operations. It does not inspect whether the simulation insert actually won the idempotency claim before writing the position.
- A repeated simulation missing from the 50-row read can conflict/no-op in AI history and still overwrite the same paper-position aggregate with a fresh entry payload, potentially erasing exit history.
- PA.4 suppresses an exit fingerprint only while that exit remains in the aggregate's bounded exit array.
- The legacy paper-order path has no durable idempotency key across Functions or restarts.

Required control: claim a unique tenant/account/execution fingerprint inside the same PostgreSQL transaction that applies the account and position mutation. A conflict must return the previously committed result and must not reapply or overwrite state.

## Recommended durable source-of-truth model

### 1. Opportunity evidence

Reuse `atlas_ai_opportunity_analysis_history` for:

- explicit human-reviewed Trade Quality snapshots;
- PA.1 evaluation decisions and evidence fingerprints;
- advisory/history context.

Wire its repository to the canonical DB adapter. Do not persist raw provider payloads, candles, prompts, or derived briefing/learning output. Retain organization, team, account, and user filters.

### 2. Paper execution ledger

Maintain an append-only record for each accepted PA.2 entry and PA.4 exit containing tenant/account/user, fingerprint, evaluation/candidate lineage, side, quantity, fill, fees, slippage, timestamps, and realized P&L where applicable.

The existing `atlas_realtime_simulated_executions` table/repository is a useful starting contract, but it lacks explicit account and user columns and a tenant/account fingerprint uniqueness boundary. AI history alone is evidence storage, not an accounting ledger.

### 3. Canonical paper account and positions

Maintain exactly one current account projection per organization/team/account/owner and one current position projection per account/position. The account owns cash, equity/buying-power inputs, cumulative realized P&L, and a concurrency/version field. Positions own quantity, side, cost basis, and open/closed state.

The generic `atlas_operator_actions` paper aggregate is a useful compatibility bridge, but it is not an adequate final account store: it has no account column, relies on bounded generic listing, embeds ledger history inside mutable JSON, and cannot enforce accounting invariants relationally.

### 4. Derived projections

Recompute these from the ledger/account/position/evidence sources:

- journal trade rows;
- portfolio summary and equity curve;
- Paper Performance Review;
- Paper Learning Evidence;
- Daily Briefing paper context;
- scanner matches, Trade Quality, regime, and strategy suitability.

Persist optional human journal annotations separately only if the product supports them.

## Required transaction boundaries

### PA.2 accepted entry

One PostgreSQL transaction must:

1. lock/read the canonical account;
2. claim the unique tenant/account/simulation fingerprint;
3. revalidate or apply the approved paper execution against that account version;
4. append the execution record;
5. update cash/account totals;
6. insert/update the position and cost basis;
7. commit the evaluation/execution linkage;
8. return the committed projection.

Any failure rolls back all steps. A duplicate returns the prior committed result without a second account/position mutation.

### PA.4 partial/full exit

One PostgreSQL transaction must:

1. lock/read the account and open position;
2. claim the unique exit fingerprint;
3. validate exit quantity against the locked position;
4. append the exit execution and realized P&L;
5. update/close the position and cost basis projection;
6. update account cash and cumulative realized P&L;
7. commit entry/exit/evaluation linkage.

Opportunity review, PA.1 evaluation, scanner definition, alert definition, and journal annotation are independent single-record writes and do not need to join the accounting transaction.

## Schema and migration assessment

No migration is needed for durable Trade Quality reviews or PA.1 evaluations; `atlas_ai_opportunity_analysis_history` already supports their tenant/account/user boundary.

No migration is needed for scanner and alert P1 durability if the existing `atlas_realtime_scanner_subscriptions` and `atlas_realtime_alerts` contracts are adopted with an approved ownership model.

At least one future migration appears necessary for trusted paper accounting. Existing tables do not jointly provide:

- a canonical paper account row;
- an account-scoped position/cost-basis projection;
- account/user columns and a unique idempotency fingerprint on simulated executions;
- relational entry/exit linkage and concurrency control.

The future design may add dedicated paper account/position/execution tables or carefully extend the Phase 69 real-time tables. That choice requires a focused schema review; PI.1 does not authorize either implementation. No table is needed solely for Performance, Learning, or Daily Briefing outputs.

## Smallest future implementation sequence

### PI.2 — Canonical paper workflow and evidence handoff

- Owner selects guarded PA.2 as the canonical paper-order path or explicitly selects the legacy path.
- Wire the AI opportunity repository to the canonical PostgreSQL adapter.
- Add the explicit browser review/save handoff from Trade Quality to opportunity review.
- Make PA.1 evaluation and PA.2 simulation evidence durable and account/user scoped.
- Preserve advisory-only, manual-trigger, paper-only, and existing risk decisions.

### PI.3 — Transactional paper account, execution, and position core

- Approve the minimal account/position/execution schema migration.
- Implement unique execution fingerprints and account/position locking/versioning.
- Commit PA.2 entry and PA.4 exit as atomic ledger/account/position transactions.
- Prevent duplicate reapplication and preserve entry/exit lineage.
- Route or retire the non-canonical legacy paper ledger so only one account source remains.

### PI.4 — Durable projections and P1 operator state

- Derive portfolio, Journal trade rows, Performance, Learning, and Daily Briefing from the canonical durable sources.
- Adopt existing PostgreSQL scanner/alert tables for supported configuration/lifecycle state.
- Add separate journal annotations only if owner-approved product behavior requires them.
- Prove cold-start, cross-instance, replay, rollback, and multi-tenant behavior against an approved non-production database.

Do not combine these phases: PI.2 establishes valid upstream evidence, PI.3 establishes accounting truth, and PI.4 changes read projections and P1 configuration.

## Owner decisions required

1. Confirm the canonical paper-order path. PI.1 recommends guarded PA.2 and retirement/routing of legacy `submit-paper-order` before production.
2. Confirm paper-account ownership: organization + team + account + user, or team-shared account. Current APIs mix these concepts.
3. Confirm that current average-cost behavior remains the approved paper cost-basis method; PI.1 does not change it.
4. Confirm immutable execution/exit retention and opportunity-evidence retention. Accounting ledger records must not expire with advisory evidence.
5. Decide whether scanner/alert definitions are personal or team-shared.
6. Decide whether Journal supports mutable human notes; trade rows themselves should remain derived from immutable executions.

## Known limitations and stop conditions

- No approved non-production database was available; no runtime SQL or concurrency behavior was tested.
- DB.1 backup/restore and deployed capacity evidence remain pending.
- The current generic paper-position list is capped at 100 rows; the AI evaluation/simulation reads are capped at 50.
- Current PA.2 multi-fill calculations do not apply successful fills sequentially to one account.
- Current paper positions and AI evidence can diverge because they are separate writes and repositories.
- PI.1 does not choose table names, write a migration, change a Function, or authorize a new service.
- If the future accounting model cannot be expressed safely in existing PostgreSQL without a material architecture decision, stop for an ADR. Do not add Redis, a queue, another database, a managed proxy, or a paid service.

## Cost impact

PI.1 has no infrastructure cost. The recommended future path uses the existing PostgreSQL architecture and adds no vendor, Redis, queue, cache service, or recurring infrastructure. Database storage and connection capacity must still be verified within the already approved deployment plan.

## Explicit non-changes

PI.1 changes documentation only. Application behavior, AUTH.1/AUTH.2, endpoint authorization, CSRF, trading and risk logic, AI behavior, market providers, database schema/vendor, billing, and paid-service behavior remain unchanged.

## PI.3 closure update

PI.3 adds migration `202608130069_pi3_transactional_paper_account_ledger` and closes the accounting-continuity P0 design gap at repository level. Account initialization is once per scope, entries and exits use one PostgreSQL transaction, locks and revisions protect current state, and database uniqueness provides restart-safe idempotency. Details are in [Canonical paper account and execution ledger](./CANONICAL_PAPER_ACCOUNT_LEDGER.md).

Deployed migration, transaction, concurrency, pool-capacity, backup, and restore evidence remains **NOT VERIFIED / OWNER ACTION REQUIRED**. The legacy public paper-order path, transactional distributed daily quota, and deployed authenticated smoke exercise remain outside PI.3.
