# Atlas Market Fixed Forward Paper Observation

Status: EDGE.2 infrastructure ready; production cohort `NOT_STARTED`.

## Purpose

EDGE.2 defines a fixed, paper-only observation protocol for evaluating forward expectancy without changing strategy parameters, Trade Quality weights, regime thresholds, risk limits, the symbol universe, entry logic, or exit logic during the cohort.

The first review is prohibited until both minimums are satisfied:

- 20 distinct observed trading sessions;
- 30 completed PI.3/PA.4 paper outcomes.

Interim results are descriptive. Atlas does not label the strategy profitable or unprofitable while collection is incomplete.

## Production start blockers

The cohort has not started for two evidence-quality reasons:

1. `index-pullback-v1` remains a validated, human-review lifecycle record rather than an active strategy, so SI.1 correctly returns `CONDITIONAL` instead of `ENABLED`.
2. PA.4 provides safe, manually confirmed reduction and close accounting, but the current strategy definition does not declare a deterministic exit policy suitable for comparable fixed-cohort outcomes.

EDGE.2 does not invent an exit rule or activate the strategy. A separately approved strategy-lifecycle decision must supply deterministic entry/exit criteria before a production manifest may be created.

## Frozen experiment manifest

`forward-observation-v1` freezes:

- observation ID and start timestamp;
- strategy versions;
- regime, Trade Quality, and risk-policy versions;
- real-provider and freshness requirements;
- the fixed `SPY`, `QQQ`, `IWM`, `AAPL`, `MSFT` universe;
- eligibility rules;
- starting PI.3 paper-account state;
- deterministic exit-policy version;
- 20-session and 30-outcome minimums;
- PAPER ONLY, no automatic execution, and no-optimization boundaries.

The manifest fingerprint covers the frozen configuration. A version or configuration change produces `INVALIDATED`; Atlas does not silently mix cohorts.

## Immutable evidence snapshot

`forward-evidence-snapshot-v1` records only compact qualifying evidence:

- observation and manifest identity;
- symbol, strategy, and timestamp;
- provider and live quote status;
- trend, volatility, and risk regime plus confidence;
- strategy-suitability decision and confidence;
- Trade Quality score, band, confidence, status, and existing dimension results;
- liquidity and risk/reward status;
- entry, stop, and target references;
- paper-evaluation status and engine versions;
- explicit paper-only boundaries.

Raw candles, provider payloads, credentials, browser tokens, and live-order instructions are excluded. Snapshots use unique evidence fingerprints and append-only inserts in the existing tenant-scoped PostgreSQL opportunity-evidence history. The PI.3 execution ledger remains the only paper trade ledger.

## Eligibility and scanner evidence

The existing scanner review path now assembles server-side quote, signal, risk/reward, stop/target, regime, suitability, and Trade Quality context when an operator selects a scanner match. This does not change scanner ranking or TQ formulas. A candidate still fails closed unless the provider is real, the quote is fresh, history and regime are sufficient, suitability is `ENABLED`, TQ evidence is sufficient, liquidity/risk-reward evidence passes, and existing risk gates pass.

No automatic paper execution was added. Qualifying evidence continues through the existing human-controlled path:

`scanner evidence -> reviewed opportunity -> PA.1 -> PA.2 -> PI.3 -> PA.4 -> PA.3 -> PA.5`

## Status and review

The read model uses:

- `NOT_STARTED`
- `COLLECTING`
- `MINIMUM_SESSIONS_PENDING`
- `MINIMUM_OUTCOMES_PENDING`
- `READY_FOR_REVIEW`
- `INVALIDATED`

Only `READY_FOR_REVIEW` can emit a conservative `PROMISING`, `INCONCLUSIVE`, `CAUTION`, or `DEGRADED` classification. The review reuses PA.3 metrics and PA.5 Trade Quality calibration; it does not persist another analytics ledger or modify Atlas automatically.

The Reports workspace exposes a compact read-only panel with session/outcome progress, cohort status, the frozen fingerprint, PAPER ONLY, and NO OPTIMIZATION DURING OBSERVATION labels.

## Cost and operations

No provider, paid tier, Netlify upgrade, database vendor, broker, queue, or recurring service was added. Scanner quality review reuses existing server-side paths and remains operator-triggered. The bounded five-symbol production check remains within the EDGE.1 free-tier budget.

The market-hours production check remains pending when no authenticated owner browser session is available. Atlas must not bypass the authentication boundary or copy provider secrets locally to perform that check.
