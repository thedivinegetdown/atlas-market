# Guarded Paper Order Simulation

PA.2 is an authenticated, CSRF-protected, manual paper-simulation boundary. It accepts only PA.1 `APPROVED_FOR_PAPER_REVIEW` records and never runs on route mount, a timer, or a background worker.

## Controls and lifecycle

- `PAPER_AUTOMATION_ENABLED` is server-only and defaults off. It controls this batch path only; ordinary manual paper trading is unchanged.
- A cycle evaluates at most three records. The default daily maximum is ten simulated fills. Daily counting uses existing history, but enforcement is not a distributed atomic quota.
- Evidence older than 24 hours and non-approved states cannot simulate.
- Side, leverage, price, stop, target, and quantity are never invented. Existing sizing supplies quantity only after explicit price and stop context exists.
- The deterministic guardrail runs immediately before simulation and retains authority over risk, heat, buying power, cash, and paper mode.
- Duplicate identity includes evaluation, candidate, strategy, engine/evidence version, side, quantity, and price.

## Simulation and accounting boundary

PA.2 reuses `simulateRealtimePaperExecution`. That existing lifecycle calculates a simulated fill, paper-accounting result, and journal result in memory. PA.2 does not call a live broker. Before any filled compatibility projection is written, it durably claims an append-safe execution-intent record in `atlas_ai_opportunity_analysis_history`, including reviewed candidate identity, PA.1 evaluation id and evidence fingerprint, proposed plan, guardrail outcome, simulation status, strategy, symbol, and versions. A database conflict returns `DUPLICATE_SUPPRESSED` and does not rewrite the position projection.

No raw candles, provider payloads, credentials, or AI payloads are stored. The endpoint makes no market-data request and fails closed with `durable_paper_evidence_unavailable` if the canonical database repository is disconnected. Scanner is labeled **PAPER ONLY**; Dashboard has no execution control.

The durable PI.2 record remains execution intent/audit evidence. PI.3 now supplies the separate canonical cash/account/position source and atomically commits the immutable execution, account mutation, and position projection after the intent claim. The daily-limit calculation remains a history-derived, non-distributed throttle.

Statuses are `SIMULATED_FILLED`, `SIMULATION_REJECTED`, `DUPLICATE_SUPPRESSED`, `STALE`, `INSUFFICIENT_ORDER_CONTEXT`, and `ERROR`. They describe simulated outcomes only, never real orders or unattended authorization.

Completed closing/reducing lifecycles can be reviewed by the read-only [Paper Performance Review](./PAPER_PERFORMANCE_REVIEW.md). Opening fills are not treated as completed performance outcomes.

## PI.3 canonical accounting handoff

After existing gates pass and the PI.2 intent is durably claimed, PA.2 commits the simulated fill through the PI.3 PostgreSQL transaction. Sizing and guardrails use the current durable account and open-position projection, not the process-local default account. The transaction verifies PA.1/PA.2 linkage, locks current state, appends the immutable execution, and updates account cash, buying power, equity, and cost basis. A duplicate ledger fingerprint performs no second mutation. The daily throttle remains explicitly non-distributed. See [Canonical paper account and execution ledger](../persistence/CANONICAL_PAPER_ACCOUNT_LEDGER.md).

PI.4 changes no PA.2 decision, sizing, guardrail, simulation, or accounting formula. It exposes the canonical account/position/execution state through durable read projections; the legacy `submit-paper-order` account remains compatibility-only.
