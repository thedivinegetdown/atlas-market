# Canonical paper account and execution ledger

Status: PI.3 repository implementation complete; deployed PostgreSQL execution not verified
Scope: paper trading only

## Source-of-truth model

PI.3 makes the existing PostgreSQL architecture authoritative for the canonical PA.2 → PA.4 lifecycle. `atlas_paper_accounts` owns cash, buying power, equity, cumulative realized P&L, and a revision. `atlas_paper_executions` is the immutable entry/reduction/close ledger. `atlas_paper_positions` is the account-scoped open/closed quantity and average-cost projection. Every record is scoped by organization, normalized team workspace, logical account, and user.

The approved starting balance remains $100,000. Account creation uses the unique tenant/account scope and `INSERT ... ON CONFLICT DO NOTHING`; it occurs exactly once even under concurrent initialization. Later requests read the stored account and never reset it on process start.

## Entry transaction

After the existing PA.2 eligibility, freshness, sizing, guardrail, kill-switch, cycle, and daily gates pass, the Function durably claims the PI.2 intent and starts one database transaction:

1. create or lock the canonical account with `SELECT ... FOR UPDATE`;
2. verify the tenant-scoped PA.1 evidence fingerprint and PI.2 intent fingerprint;
3. lock the account's open position projection;
4. recompute the existing accounting engine against current durable state;
5. insert the immutable execution under the account/fingerprint unique constraint;
6. update the account with a revision predicate;
7. insert or update the position/cost basis;
8. commit.

Any exception rolls the whole transaction back. A duplicate fingerprint returns the prior execution and performs no cash or position mutation. The compact ledger payload keeps evaluation, intent, candidate, strategy, journal, provenance classification, and engine linkage; raw candles, provider payloads, credentials, prompts, and secrets are excluded.

## Reduction and close transaction

PA.4 obtains a fresh quote only after explicit confirmation, then locks the scoped account and selected position. It validates the current position and quantity, checks durable idempotency, and reuses `paper-exit-v1`, the execution simulator, paper accounting, and journal normalization. The transaction inserts one reduction/close execution, revision-updates account cash/equity/realized P&L, and revision-updates the position. A partial reduction preserves average cost. A full close stores zero quantity and `closed`, so it cannot be returned as an open position or accidentally reopened by an exit.

Long exits use `sell`; short exits use `cover`. No new P&L, slippage, fee, sizing, strategy, scoring, regime, or risk formula was introduced.

## Concurrency and idempotency

- Account and exit position rows are locked for transaction duration.
- Account and position writes require the revision read inside the transaction.
- `(account_record_id, idempotency_fingerprint)` is unique for executions.
- Account scope and account/symbol/asset/side position identity are unique.
- Serialized conflicting transactions cannot double-debit cash, double-count realized P&L, exceed position quantity, or duplicate a fill.
- Retry identity survives cold starts, deployments, and different Function instances because it is enforced in PostgreSQL, not memory.

The PA.2 daily limit remains history-derived rather than a transactional distributed quota. It is a safety throttle, not accounting truth.

## Analytics and journal

PA.3 and PA.5 read tenant-scoped realized reduction/close executions from the immutable ledger and deterministically recompute their existing analytics. They do not persist derived performance or learning output. Compact normalized journal evidence is stored with each execution; it does not create a second accounting ledger. Human annotations remain outside PI.3.

## Failure contract

The canonical workflow fails closed with stable public codes when PostgreSQL is unavailable, scope is invalid, evidence linkage is missing, or durable state conflicts/is inconsistent. Driver details and `DATABASE_URL` are never returned. Production never falls back to process memory and reports success.

## Legacy compatibility

`submit-paper-order`, the process-memory paper account/order/journal repositories, and `paperPositionStore` remain compatibility-only. New intelligence-driven PA.2 entries and PA.4 exits do not call that position store. Retirement of the legacy public path and its UI/data consumers is a separate authorized phase.

## Deployment verification still required

No approved local or non-production PostgreSQL target was available for PI.3. The owner must apply/rehearse migration `202608130069_pi3_transactional_paper_account_ledger` on an approved restored non-production database, verify migration tracking and rollback, run two-tenant entry/exit concurrency checks, confirm pool capacity, then capture deployed authenticated PA.2/PA.4 evidence. Production must not be contacted for this verification without explicit approval.
