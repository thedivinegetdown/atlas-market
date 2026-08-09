# Controlled Automated Paper Evaluation

PA.2 may consume an approved result only through the separately documented [Guarded Paper Order Simulation](./GUARDED_PAPER_ORDER_SIMULATION.md) manual, kill-switched boundary. PA.1 itself still never creates an order.

Version: `paper-evaluation-v1`

## Purpose and execution boundary

PA.1 evaluates at most five explicitly reviewed OI.1 candidates for human paper-trading review. It automates deterministic analysis only. It does not submit paper orders, call a broker, create simulated fills, mutate portfolios, activate strategies, change scanner ranking, or invoke AI.

The entry point is `evaluatePaperCandidates({ candidates, regime, strategySuitability, portfolioRisk, existingEvaluations })`. It consumes resolved read models and has no provider or execution dependency.

## Trigger and lifecycle

The only production trigger is the authenticated, CSRF-protected **Run Paper Evaluation** operator action in Scanner / Opportunity Review. Atlas has execution-oriented paper coordinators and polling utilities, but PA.1 intentionally does not call or schedule them. No timer, worker, cloud scheduler, recurring service, or continuous loop is added. Scheduled evaluation remains future scope.

Each manual cycle reads at most five eligible `saved` or `reviewed` OI.1 quality snapshots, resolves one shared market overview and SI.1 suitability context, reads the existing portfolio summary, evaluates locally, and stores only new compact summaries.

## Eligibility and status meanings

Candidates require valid symbol and strategy context, an unexpired/non-dismissed OI.1 record, deterministic TQ.1 evidence, current regime evidence, matching SI.1 metadata, and no blocking safety condition. Lean scanner records with unknown strategy context remain excluded.

- `APPROVED_FOR_PAPER_REVIEW`: score is at least 80, regime is complete, strategy is enabled, evidence is fresh, and no blocker exists.
- `WATCH`: evidence is reviewable but does not meet the approval conditions.
- `REJECTED`: quality is below 55 or a deterministic strategy, liquidity, risk, or drawdown blocker applies.
- `INSUFFICIENT_DATA`: required candidate, score, or strategy evidence is missing.
- `STALE`: candidate or regime evidence is stale.
- `ERROR`: reserved for an orchestration failure; errors do not create approvals.

These statuses never authorize execution. Every result declares `paperTradingOnly: true`, `advisoryOnly: true`, `automaticExecution: false`, and `humanReviewRequired: true`.

## Risk authority

Existing evidence remains authoritative. Disabled SI.1 strategies, TQ.1 liquidity or risk blockers, severe portfolio drawdown at or above 20%, stale regime evidence, and missing strategy context prevent approval. Drawdown at or above 10% creates caution evidence. PA.1 does not recalculate or override risk limits and does not call order-oriented risk APIs with fabricated order inputs.

## Deduplication and persistence

The evidence fingerprint contains candidate ID, strategy ID, regime version/as-of, TQ version/as-of, and suitability decision. An unchanged fingerprint reuses the existing result and creates no duplicate history. Changed evidence creates a new evaluation.

Compact results reuse `atlas_ai_opportunity_analysis_history` with category `paper_evaluation`; no table or migration is added. Persistence contains identifiers, statuses, compact regime/suitability/risk summaries, reasons, blockers, missing evidence, timestamps, versions, and the fingerprint. Raw candles, provider payloads, credentials, prompts, AI responses, and unnecessary portfolio internals are excluded. Reads and writes retain organization/team/account/user isolation.

## Request and briefing integration

One cycle uses one shared historical market-overview request regardless of candidate count. It creates no provider request per candidate or score dimension and inherits MI.5 cache, deduplication, and free-tier controls.

OI.1/DB.1 attaches the latest compact evaluation to matching reviewed opportunities. Daily Briefing displays status, risk state, evaluation time, and the explicit human-review requirement. It remains an intelligence surface, not an execution console.

## Limitations

- The production OI.1 feed remains limited to explicitly retained TQ.1 snapshots with valid strategy context.
- The current modeled strategy lifecycle often yields `WATCH` rather than approval until an existing strategy is genuinely active and eligible.
- Manual evaluation is the only trigger. Scheduled automation and all paper-order execution require separate architecture approval.
