# Atlas Intelligence 2.0: Decision-Engine Architecture Gap Audit

Status: Architecture audit only  
Effective date: 2026-08-27  
Scope: INTEL.1  
Source of truth: current repository contracts and tests

## Executive decision

Atlas already has a credible evidence foundation: real Twelve Data provenance, deterministic market regime and strategy-suitability engines, Trade Quality (TQ), scanner and opportunity review, paper evaluation and execution, deterministic exits, PostgreSQL-backed paper evidence, PA.3 performance review, PA.5 learning evidence, Atlas Copilot safeguards, and the frozen EDGE.2 forward-observation cohort.

The smallest viable evolution is not a new trading brain. It is a set of additive, read-only composition contracts that make existing evidence comparable, explainable, and traceable from candidate review through paper outcome. Existing deterministic engines retain authority. New orchestration must never change EDGE.2, strategy rules, TQ weights or thresholds, regime rules, risk configuration, sizing, exit policy, or eligibility rules.

## Current Decision Pipeline

| Target stage | Implemented evidence | Audit finding |
| --- | --- | --- |
| Market evidence | Market provider contracts, Twelve Data, normalization, provenance, freshness, scanner inputs | Present; provenance/freshness must remain attached to downstream plans. |
| Regime | `lib/market/regime/` and `market-regime-v1` | Present and authoritative. |
| Strategy selection | `adaptive-strategy-v1` | Present for an input strategy list; approved config currently contains only `index-pullback-v1`. |
| Candidate generation | Scanner, TQ candidate normalization, opportunity feed | Present, but candidate contracts are not one canonical plan. |
| Trade Quality | `trade-quality-v1` | Present and authoritative for per-candidate TQ, reasons, blockers, coverage, and model-quality confidence. |
| Risk/sizing | Existing risk engines, paper evaluation, position sizing | Present; a plan must reference outputs rather than replicate them. |
| Cross-market ranking | TQ feed sorting and `atlas-opportunity-ranking-v1` | Partial; current ranking is deterministic/advisory but uses a legacy opportunity shape and is not portfolio-admission aware. |
| Qualified Trade Plan | Paper evaluation and forward snapshots carry portions of a plan | Missing canonical, read-only composition object. |
| Evidence-calibrated confidence | EDGE evidence, PA.3, PA.5, forward status | Partial; no candidate-level empirical projection and no valid cohort has been asserted here. |
| Human decision and paper outcome | Review states, paper evaluation/simulation, PA.4 exits, ledger | Present. |
| Decision-quality learning | PA.3/PA.5 and EDGE.2 status reuse | Present for descriptive aggregates; missing plan-linked monitoring and mature comparable-setup projection. |
| Copilot explanation | Atlas Copilot and opportunity explainability | Present but not yet supplied with the canonical deterministic plan. |

## Non-Negotiable Boundaries

- EDGE.2 remains frozen. Its manifest, universe, strategy version, rules, TQ configuration, regimes, risk policy, sizing, eligibility, deterministic exit policy, and minimums remain untouched.
- The current serious strategy is `index-pullback-v1`; no future strategy family is authorized by this audit.
- Paper trading and a human decision remain required. No live brokerage integration, autonomous order creation, or AI-directed execution is in scope.
- TQ is a model-quality score, not an empirical probability of profit. Strategy suitability is a deterministic compatibility decision, not empirical validation.
- PA.3/PA.5 and EDGE.2 are descriptive evidence layers. They must not optimize, activate, disable, reweight, or mutate strategies automatically.
- Provenance, freshness, policy/strategy fingerprints, evidence identifiers, and deterministic reasons must remain visible to every consumer.

## A. Multi-Strategy Intelligence

### What exists

`adaptiveStrategyEngine` evaluates supplied strategy metadata against one normalized market-regime result. It supports lifecycle state, required indicators, per-strategy compatibility rules, deterministic reasons, blockers, and `ENABLED`/`CONDITIONAL`/`DISABLED`/`UNKNOWN` decisions. Its use of `strategies` input and configuration keyed by `strategyId` is a sound reuse point.

`multiStrategyPortfolioManager` separately models a strategy registry, priorities, duplicate-symbol and conflicting-direction detection, strategy exposure/risk budgets, and paper-only proposed-trade review. Portfolio factor exposure also models concentration, sector correlation, beta, momentum, volatility, and strategy risk context.

### What is partial

The approved adaptive configuration and strategy records contain only `index-pullback-v1`. The multi-strategy portfolio manager uses a different, broad strategy schema and is not the adaptive engine's lifecycle/configuration authority. Neither provides a versioned strategy-family contract that can register trend-pullback, breakout/momentum, range mean-reversion, or volatility expansion/contraction independently without adding bespoke configuration and integration.

### What is missing and minimum addition

Add a small strategy-family registry contract, not strategy implementations. It should declare identity, version, lifecycle, supported asset classes/timeframes, required evidence, a pointer to approved suitability rules, and a plan-construction adapter. The adaptive engine remains the evaluator; the existing multi-strategy manager remains a portfolio conflict/exposure input. A registry adapter is genuinely necessary to prevent strategy-specific branching in the plan composer and ranking path.

Dependencies: strategy metadata normalization, adaptive suitability, current lifecycle governance, and multi-strategy portfolio/factor-exposure read models.  
Risk: MEDIUM. The greatest risk is accidentally treating a registry addition as authorization to alter the single frozen strategy. New families must enter as inactive/unapproved metadata until separately governed.  
EDGE.2 dependency: no. EDGE.2 must not consume a changed registry or strategy configuration during its frozen cohort.

## B. Cross-Symbol Opportunity Ranking

### What exists

`tradeQualityEngine` scores individual candidates using regime fit, strategy suitability, trend, momentum, relative strength, volume, volatility, liquidity, and risk/reward. It produces bounded TQ, confidence, coverage, reasons, blockers, freshness, and a paper/advisory boundary.

`opportunityIntelligenceFeed` deterministically sorts reviewed TQ snapshots by TQ, then TQ confidence, freshness, and identifier. `opportunityAnalysisEngine` has `atlas-opportunity-ranking-v1`, a deterministic advisory ranking with freshness, data quality, liquidity, compatibility, risk, invalidation, degraded-provider, and evaluator-warning contributions. The multi-strategy and factor-exposure engines expose duplicate symbols, conflicts, strategy budgets, concentration, and sector-correlation context.

### What is partial

The TQ feed is a display ordering, not cross-market decision admission. The Atlas opportunity ranker consumes a legacy normalized opportunity contract, takes a scanner score as a principal contribution, and does not consume canonical TQ, an authoritative sizing/risk result, or the existing portfolio managers as vetoing inputs. Its `confidence` is bounded ranking metadata, not empirical evidence.

### What is missing and minimum addition

Add a deterministic Qualified Opportunity Ranking adapter that accepts only valid Qualified Trade Plans. It must preserve TQ and risk authority: it may order eligible plans and explain portfolio-relative penalties, but cannot raise TQ, convert a blocked risk decision into a qualified one, manufacture size, or turn a rejected plan into actionable output. Reuse `atlas-opportunity-ranking-v1` contribution/explainability conventions where their source fields remain valid; do not duplicate TQ or suitability formulas.

The adapter's explicit inputs should be TQ, suitability decision, plan-level model confidence, deterministic reward/risk, liquidity and relative-strength evidence already captured by TQ, plan freshness, existing risk/sizing result, duplicate/conflict output, and portfolio concentration/correlation/exposure outputs. It should publish rank, ranking tier, component reasons, exclusions, and a deterministic tie-breaker. Correlation/exposure are admission/ranking constraints, not a substitute scoring system.

Dependencies: Qualified Trade Plan, current ranking engine, multi-strategy portfolio manager, portfolio factor exposure, authoritative portfolio risk read model.  
Risk: MEDIUM. Main risk is score duplication or allowing a rank to imply qualification.  
EDGE.2 dependency: no for ranking of current plans. Any empirical-confidence input remains unavailable until valid evidence exists.

## C. Evidence-Calibrated Confidence

### What exists

TQ emits `confidence` based on input coverage, freshness, regime status, and blockers. Adaptive suitability emits a separate deterministic compatibility confidence. EDGE evidence snapshots persist regime, suitability, TQ, price references, liquidity, exit-policy/policy fingerprints, and provider provenance. PA.3 calculates realized win rate, expectancy, profit factor, drawdown, quality bands, strategy/regime/symbol groups, and recent trend. PA.5 preserves sample maturity and describes TQ calibration while explicitly preventing optimization.

### What is partial

PA.5 can identify `CONSISTENT`, `MIXED`, `INVERTED`, `UNSTABLE`, and `INSUFFICIENT_DATA` quality-band evidence, but it is aggregate and does not expose a comparable-setup cohort keyed to canonical plan attributes. EDGE.2 can become `READY_FOR_REVIEW` only after its frozen minimum of 20 sessions and 30 completed outcomes, but this audit does not establish that it is currently ready.

### What is missing and minimum addition

Add an Evidence Confidence Projection adapter only after eligible, immutable forward evidence is available. It must select comparable observations using version/fingerprint-safe fields such as strategy version, side, regime dimensions, TQ band/range, liquidity state, reward/risk band, timeframe, provenance/freshness, and exit-policy fingerprint. It returns no empirical value when sample adequacy, configuration compatibility, or cohort homogeneity is not met.

There are two permanently distinct fields:

| Field | Source and meaning | Forbidden interpretation |
| --- | --- | --- |
| Model quality score/confidence | Existing TQ and strategy-suitability outputs; completeness and deterministic fit | Probability of profit or empirical forward validation |
| Empirical forward evidence/confidence | PA.3/PA.5/EDGE cohort projection with sample count, maturity, performance, comparability, and validity state | Guaranteed return, causal proof, or a replacement for risk/TQ |

Do not create artificial probability estimates. The projection should use statuses such as `UNAVAILABLE`, `INSUFFICIENT_SAMPLE`, `NOT_COMPARABLE`, `DESCRIPTIVE`, `CAUTION`, or `MATURE_DESCRIPTIVE`, plus raw observed metrics and sample counts when valid.

Dependencies: frozen EDGE.2 manifest/snapshots/outcomes, PA.3, PA.5, outcome-to-plan linkage, and a comparable-cohort specification.  
Risk: LARGE. Statistical overclaiming, cohort leakage across fingerprints, and accidental optimization are material risks.  
EDGE.2 dependency: yes. Candidate-level empirical confidence must wait for EDGE.2's evidence minimum and a human-reviewed comparable-cohort policy.

## D. Canonical Qualified Trade Plan

### What exists

Trade Quality snapshots include symbol, strategy, TQ, confidence, evidence, freshness, and an `orderContext` with entry/stop/target. Paper evaluation carries an evidence fingerprint, status, risk-safety result, order context, and engine versions. Paper simulation and deterministic exits link evaluation and policy evidence. Forward snapshots preserve immutable entry/stop/target, reward/risk, liquidity, provenance, strategy/regime/TQ data, and policy fingerprints.

### What is partial

These are lifecycle-specific records with overlapping fields. They are not one canonical object, do not provide one explicit `QUALIFIED`/`WATCH`/`REJECTED`/`NO_TRADE` status, and do not consistently expose model versus empirical confidence or all supporting/opposing evidence to a single read-only consumer.

### What is missing and minimum addition

Add `QualifiedTradePlanComposer`, a pure deterministic read-model composer. It is genuinely necessary because no existing object has the required composition boundary. It must consume, never recalculate: market/regime output, adaptive suitability, TQ result, existing risk/sizing evaluation, deterministic exit/target context, portfolio constraints, and the optional Evidence Confidence Projection.

The output must be immutable/read-only and include:

- `planId`, symbol, side, strategy identity/version, regime, TQ, model confidence, and empirical evidence section.
- Entry zone, stop/invalidation, target, R multiple, allowed position size, maximum planned loss, and potential target gain.
- Supporting evidence, opposing evidence, explicit deterministic reasons/blockers, and one final status: `QUALIFIED`, `WATCH`, `REJECTED`, or `NO_TRADE`.
- Market-data provider/provenance/freshness, as-of timestamps, source evidence IDs/fingerprints, and strategy/policy/engine fingerprints.
- Explicit boundaries: paper only, human decision required, no broker execution, no AI override, and no promised outcome.

`QUALIFIED` is possible only when all required existing authorities allow it. `WATCH` expresses incomplete/non-blocking review evidence; `REJECTED` retains a deterministic blocker; `NO_TRADE` means no valid candidate/plan was formed. The composer must not generate signals, alter prices, calculate a new TQ, perform new risk policy, or create orders.

At first, a plan can be ephemeral and persisted by reference only when it enters existing reviewed/paper-evaluation evidence paths. A separate ledger or migration is not justified until the integration phase proves that existing canonical paper-evidence storage cannot retain an immutable plan snapshot and provenance link.

Dependencies: existing TQ, regime, adaptive suitability, paper evaluation, sizing/risk, exit-policy data, and canonical paper-evidence repository.  
Risk: MEDIUM. The principal risk is parallel calculations drifting from authorities; contract tests must assert source linkage and absence of duplicated formulas.  
EDGE.2 dependency: no. The empirical section must state `UNAVAILABLE` until valid evidence is supplied.

## E. Decision Quality and Performance Monitoring

### What exists

PA.3 (`paperPerformanceReviewEngine`) already computes completed-trade metrics including win rate, expectancy per trade, profit factor, average win/loss, maximum drawdown, and recent trend. It groups results by strategy, TQ band/score range, trend/volatility/risk regime, symbol, asset type, and month with sample maturity. PA.5 adds bounded descriptive strategy/regime evidence and quality calibration, including unequal-sample disclosure. EDGE.2 reuses PA.3/PA.5 status and blocks profitability classification before its session/outcome minimums.

### What is partial

The existing data model tracks many evaluation/simulation/evidence fingerprints, but no read model joins a canonical Qualified Trade Plan to realized outcome attribution. Current PA.3 groups do not expose mature multi-dimensional comparable cohorts or a plan-version/fingerprint breakdown. The existing realized P&L analytics are monetary; average R requires a stable planned-risk basis from the plan/evaluation record.

### What is missing and minimum addition

Add a thin Decision Quality Monitor projection over PA.3, PA.5, paper ledger/evaluation linkage, and Qualified Trade Plans. It must reuse PA.3 metrics rather than recomputing P&L. Its minimum outputs are win rate, expectancy, average R when planned risk is valid, profit factor, drawdown, strategy and regime performance, TQ calibration, outcome by quality band, rolling degradation, and sample-size adequacy. Every metric needs outcome count, maturity, window, freshness, and fingerprint/version filters.

It must be descriptive and human-reviewed. It must not change strategy activation, ranking rules, TQ, regimes, sizing, risk, or exits automatically.

Dependencies: Qualified Trade Plan provenance, existing ledger/evaluation/simulation/exit attribution, PA.3, and PA.5.  
Risk: MEDIUM. Average-R normalization and incomplete lifecycle joins require explicit exclusion and adequacy rules.  
EDGE.2 dependency: no for monitoring architecture and existing realized reporting; yes for using the frozen cohort as empirical support for the current serious strategy.

## F. Atlas Copilot Integration

### What exists

Atlas Copilot context, response, conversation, workflow, portfolio-insight, and trade-signal-explanation engines already carry advisory-only, human-review, paper-only, and no-override/no-broker flags. Opportunity explainability keeps observed evidence separate from model interpretation and excludes raw provider payloads and chain of thought. Existing Copilot safety validation rejects order/execution, mutation, unsupported target, guaranteed-profit, and risk-free language.

### What is partial

Copilot context is a broad score-based summary and opportunity analysis consumes its own normalized candidate contract. Neither uses a canonical qualified plan as the bounded, deterministic source for plan-specific explanation or comparison.

### What is missing and minimum addition

Add a Qualified Trade Plan Copilot Context adapter. It accepts an immutable plan, optional deterministic comparison set, and a bounded Decision Quality Monitor projection. It provides a source-cited fact sheet and allowed question scope to existing Copilot engines. It must distinguish observed deterministic fields, unavailable evidence, and optional model interpretation.

Copilot may summarize, explain, compare plans, surface risks, and answer questions strictly from the supplied plan/context. It may not invent market facts, override a plan's deterministic status, bypass risk controls, alter policy, independently create an executable order, or present profit as certain.

Dependencies: Qualified Trade Plan, existing Copilot context/safety engines, ranking output for comparison, and optionally the evidence-confidence projection.  
Risk: SMALL. The safety boundary exists; risk is context drift or unsupported natural-language claims.  
EDGE.2 dependency: no. It can explain `UNAVAILABLE` empirical evidence before the evidence minimum; it must wait for INTEL.6 to describe valid empirical comparisons.

## Architectural Decisions

1. Preserve authority: regime, suitability, TQ, risk/sizing, exit policy, performance, and EDGE.2 each keep their current calculation ownership.
2. Add composition/read-model adapters rather than a monolithic decision engine or new provider, scoring, analytics, or brokerage subsystem.
3. Treat `atlas-opportunity-ranking-v1` as reusable ranking/explainability infrastructure, not the future final decision authority.
4. Model confidence and empirical evidence are separate structured fields, never a blended score and never a profit probability.
5. Require every downstream decision object to retain provenance, freshness, source IDs, engine versions, and strategy/policy fingerprints.
6. Keep new strategy families independently governed and inactive until their own approved evidence plan exists. Their introduction cannot modify EDGE.2.

## Recommended Minimum Roadmap

1. INTEL.2 - Canonical Qualified Trade Plan.
2. INTEL.3 - Qualified cross-symbol opportunity ranking.
3. INTEL.4 - Multi-strategy registry and portfolio-admission alignment.
4. INTEL.5 - Decision-quality monitor and plan-to-outcome attribution.
5. INTEL.6 - Evidence-calibrated confidence after EDGE.2 evidence minimum.
6. INTEL.7 - Atlas Copilot canonical-plan integration.

INTEL.7 may be implemented after INTEL.2 and before INTEL.6 if it explicitly reports empirical evidence as unavailable. It is placed last to keep the deterministic decision contract and its monitoring stable before Copilot consumes it.