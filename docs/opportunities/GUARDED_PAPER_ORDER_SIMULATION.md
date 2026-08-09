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

PA.2 reuses `simulateRealtimePaperExecution`. That existing lifecycle atomically calculates a simulated fill, paper-accounting result, and journal result in memory. PA.2 does not call a live broker and does not independently mutate portfolio repositories. It stores compact linkage in the existing opportunity-analysis history.

No raw candles, provider payloads, credentials, or AI payloads are stored. The endpoint makes no market-data request. Scanner is labeled **PAPER ONLY**; Dashboard has no execution control.

Statuses are `SIMULATED_FILLED`, `SIMULATION_REJECTED`, `DUPLICATE_SUPPRESSED`, `STALE`, `INSUFFICIENT_ORDER_CONTEXT`, and `ERROR`. They describe simulated outcomes only, never real orders or unattended authorization.

Completed closing/reducing lifecycles can be reviewed by the read-only [Paper Performance Review](./PAPER_PERFORMANCE_REVIEW.md). Opening fills are not treated as completed performance outcomes.
