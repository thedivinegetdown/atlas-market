# Atlas Intelligence 2.0 Roadmap

Status: Proposed implementation sequence  
Effective date: 2026-08-27  
Scope: follow-on phases to INTEL.1; implementation is not authorized by this document

## Program Guardrails

All phases preserve paper-only, human-reviewed operation. They do not add providers, paid services, live brokerage execution, random indicators, or automatic optimization. EDGE.2 remains frozen: no phase changes its manifest, strategy rules, TQ weights/thresholds, regime rules, risk configuration, sizing policy, exit policy, or eligibility rules.

`index-pullback-v1` remains the only current serious strategy. Future strategy-family support means an inactive architecture boundary until separately approved strategy work exists.

## Required Sequence

```text
INTEL.2 Canonical Qualified Trade Plan
  -> INTEL.3 Qualified cross-symbol ranking
  -> INTEL.4 Multi-strategy registry and portfolio admission
  -> INTEL.5 Decision-quality monitoring
  -> INTEL.6 Evidence-calibrated confidence
  -> INTEL.7 Atlas Copilot plan context
```

## INTEL.2 - Canonical Qualified Trade Plan

- **Objective:** introduce one immutable, read-only plan that composes existing deterministic evidence into `QUALIFIED`, `WATCH`, `REJECTED`, or `NO_TRADE` without creating a new scoring or risk engine.
- **Existing architecture reused:** market provenance/freshness, Market Regime Engine, adaptive strategy selection, `trade-quality-v1`, risk and position-sizing outputs, paper evaluation, deterministic exit context, canonical paper-evidence repository, and existing strategy/policy fingerprints.
- **Unavoidable new components:** pure `QualifiedTradePlanComposer`; plan schema/validator; deterministic status mapping; source-reference/fingerprint projection. Persist by reference in existing evidence paths only if needed; do not introduce a new ledger or migration by default.
- **Explicit non-goals:** strategy changes, TQ/suitability/risk/sizing/exit recalculation, order creation, broker integration, empirical probability, UI redesign, and any EDGE.2 change.
- **Focused validation:** unit contract tests for each status and stale/blocked/no-candidate path; source-linkage assertions proving plan fields come from existing engines; immutability and provenance/fingerprint tests; confirm no order/broker/strategy mutation import path.
- **EDGE.2 evidence dependency:** No. The empirical-evidence field is explicitly `UNAVAILABLE` until INTEL.6.
- **Complexity:** MEDIUM.

## INTEL.3 - Qualified Cross-Symbol Opportunity Ranking

- **Objective:** deterministically compare valid Qualified Trade Plans across symbols while keeping TQ and risk/sizing as authorities.
- **Existing architecture reused:** `atlas-opportunity-ranking-v1` contribution/explainability patterns, `opportunityIntelligenceFeed`, TQ reasons/blockers/freshness, adaptive suitability, multi-strategy portfolio manager, portfolio factor exposure/correlation, portfolio risk, and plan provenance.
- **Unavoidable new components:** Qualified Opportunity Ranking adapter and ranking-result contract over Qualified Trade Plans; deterministic tie-breaker and explicit exclusion reasons. This is an adapter, not a replacement score engine.
- **Explicit non-goals:** TQ changes, rank-driven qualification, new indicators, AI-generated ranks, re-ranking EDGE.2 snapshots, portfolio-policy changes, automatic paper execution, and empirical confidence.
- **Focused validation:** deterministic repeatability; blocked-risk/rejected-plan exclusion; TQ authority preservation; duplicate-symbol/conflict and exposure/correlation penalties; stale/degraded evidence behavior; no executable outputs.
- **EDGE.2 evidence dependency:** No. Ranking may expose empirical evidence only as unavailable.
- **Complexity:** MEDIUM.

## INTEL.4 - Multi-Strategy Registry and Portfolio Admission

- **Objective:** make future independent strategy families pluggable through a governed registry and align their candidate admission with existing portfolio conflict/exposure evidence.
- **Existing architecture reused:** adaptive strategy metadata normalization/configuration, adaptive engine, existing lifecycle metadata, multi-strategy portfolio manager, factor-exposure engine, portfolio analytics, and strategy attribution projections.
- **Unavoidable new components:** versioned strategy-family registry contract; plan-construction adapter interface; mapping layer between adaptive strategy IDs and multi-strategy portfolio manager identities. New family records initially remain inactive/unapproved.
- **Explicit non-goals:** implementing trend pullback, breakout/momentum, range mean reversion, or volatility expansion/contraction strategies; modifying `index-pullback-v1`; enabling any additional strategy; changing strategy suitability rules; automatic allocation; altering EDGE.2.
- **Focused validation:** registry schema and lifecycle validation; a test-only inactive sample for each future family shape; compatibility with existing `index-pullback-v1`; duplicate/conflict/exposure propagation; proof that frozen EDGE.2 configuration is neither read-mutated nor substituted.
- **EDGE.2 evidence dependency:** No. This phase must not modify or route into EDGE.2.
- **Complexity:** MEDIUM.

## INTEL.5 - Decision-Quality Monitor

- **Objective:** expose plan-linked, descriptive decision-quality monitoring from realized paper outcomes with sample-size adequacy and rolling-degradation visibility.
- **Existing architecture reused:** durable PostgreSQL paper ledger, paper evaluation/simulation/exit attribution, PA.3 paper performance review, PA.5 learning evidence, existing TQ bands, regime groups, strategy/symbol groups, and EDGE.2 status projections.
- **Unavoidable new components:** Decision Quality Monitor read model; plan-to-outcome attribution projection; planned-risk eligibility/exclusion rules for average R; version/fingerprint-aware grouping and rolling-window projection.
- **Explicit non-goals:** recalculating P&L, automatic strategy optimization, parameter tuning, score/risk/regime changes, live execution, provider changes, and claims that early samples validate a strategy.
- **Focused validation:** fixture-based reconciliation to PA.3 for win rate, expectancy, profit factor, and drawdown; valid/invalid planned-risk average-R cases; strategy/regime/TQ-band grouping; rolling degradation; insufficient-sample and mismatched-fingerprint suppression.
- **EDGE.2 evidence dependency:** No for the monitor and existing realized paper data. EDGE.2-specific conclusions remain unavailable until its evidence minimum is met.
- **Complexity:** LARGE.

## INTEL.6 - Evidence-Calibrated Confidence

- **Objective:** add a candidate/plan-level empirical-forward-evidence projection for comparable setups only when frozen forward evidence is statistically and configuration-valid.
- **Existing architecture reused:** EDGE.2 manifest compatibility, immutable forward evidence snapshots, forward-observation status, PA.3 metrics, PA.5 calibration/sample maturity, Decision Quality Monitor, strategy/policy/engine fingerprints, and Qualified Trade Plans.
- **Unavoidable new components:** comparable-setup cohort specification; Evidence Confidence Projection adapter; empirical-evidence schema containing validity state, sample count/maturity, comparability dimensions, descriptive metrics, caution/degradation flags, and source fingerprints.
- **Explicit non-goals:** probability-of-profit estimates, blended model/empirical score, automatic strategy activation or deactivation, optimization, modifying EDGE.2, changing TQ, regime, risk, sizing, eligibility, or exits.
- **Focused validation:** configuration/fingerprint mismatch rejection; minimum-session/outcome gate; comparable versus non-comparable cohorts; insufficient/imbalanced samples; descriptive-only language scan; proof that model confidence and empirical evidence remain separate; no mutation side effects.
- **EDGE.2 evidence dependency:** **Yes. Must wait** until EDGE.2 is `READY_FOR_REVIEW` with its frozen 20 sessions and 30 completed outcomes, compatible configuration, and human-approved cohort rules. No current readiness is assumed by this roadmap.
- **Complexity:** LARGE.

## INTEL.7 - Atlas Copilot Canonical-Plan Context

- **Objective:** let Atlas Copilot explain, compare, and surface risks from the deterministic Qualified Trade Plan without gaining decision or execution authority.
- **Existing architecture reused:** Atlas Copilot context/response/conversation/workflow engines, opportunity explainability, response safety validation, AI gateway, advisory/paper-only flags, ranking output, and Decision Quality Monitor.
- **Unavoidable new components:** Qualified Trade Plan Copilot Context adapter; bounded plan comparison payload; source-reference formatter; response assertions for deterministic status, freshness, unavailable evidence, and no-profit-guarantee language.
- **Explicit non-goals:** independent trade discovery, market-fact invention, deterministic-decision override, risk bypass, order creation, broker execution, provider additions, hidden reasoning storage, and live trading.
- **Focused validation:** deterministic fact-sheet construction; stale/missing/unavailable evidence disclosure; comparison limited to supplied plans; safety rejection for invented prices, guaranteed outcomes, risk-policy overrides, and order instructions; degraded-AI behavior that leaves plans usable.
- **EDGE.2 evidence dependency:** No for deterministic explanation. It must wait for INTEL.6 before describing plan-level empirical evidence as valid; before then it reports the unavailable/insufficient state verbatim.
- **Complexity:** SMALL.

## Dependency and Evidence Matrix

| Phase | Can begin before EDGE.2 evidence minimum? | Must wait for empirical evidence? | Primary delivery risk |
| --- | --- | --- | --- |
| INTEL.2 | Yes | No | Duplicating existing calculations |
| INTEL.3 | Yes | No | Letting rank override qualification/risk |
| INTEL.4 | Yes | No | Accidentally authorizing/changing a strategy |
| INTEL.5 | Yes | No, except EDGE.2-specific conclusions | Incomplete plan-to-outcome attribution |
| INTEL.6 | No | Yes | Artificial probabilities or invalid cohorts |
| INTEL.7 | Yes | Only for valid empirical explanations | Unsupported AI claims/context drift |

## Immediate Recommendation

Begin **INTEL.2**. It establishes the smallest missing contract that every later phase consumes, while reusing existing deterministic authority and leaving the frozen EDGE.2 cohort untouched. Its empirical section should intentionally remain unavailable rather than inferred.