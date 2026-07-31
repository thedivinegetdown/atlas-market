# Atlas Market Deterministic Adaptive Strategy Selection

Version: `adaptive-strategy-v1`

## Purpose and boundary

SI.1 evaluates whether existing Atlas strategy registry records are suitable for the current deterministic MI.1–MI.5 market regime. It returns `ENABLED`, `CONDITIONAL`, `DISABLED`, or `UNKNOWN` as read-only suitability guidance. It cannot activate a strategy, create an order, mutate a portfolio, change scanner ranking, override risk controls, or accept an AI override.

The provider-neutral entry point is:

```js
selectStrategiesForRegime({ regime, strategies, context })
```

The engine consumes the existing regime read model and normalized strategy metadata. It does not call market-data providers, calculate indicators, invoke AI, read persistence, or execute trading logic.

## Existing strategy inventory

| Strategy identifier | Evidence in repository | Integration classification | SI.1 support |
| --- | --- | --- | --- |
| `index-pullback-v1` | Builder, rule, signal, lifecycle, registry, backtest, report, replay, and tests under `src/core/strategy/` | Modeled and comprehensively tested; the production Strategies workspace has no persisted runtime registry | Supported conservatively as a validated, human-review lifecycle record |
| `crypto-breakout-v1` | Registry test fixture only | Test-only | Not supported |
| `index-pullback`, `vol-breakout` | Multi-strategy portfolio-manager test fixtures | Test-only | Not supported |
| Scanner definitions | `lib/scanners/` | Production scanner contracts, not strategy registry records | Excluded |

SI.1 does not create trend-following, mean-reversion, VWAP, momentum, or breakout strategy definitions merely to populate the selector.

## Suitability rules

Rules are centralized in `lib/strategies/adaptive/strategySuitabilityConfig.js`.

For `index-pullback-v1`:

- Trend: `BULL` and `RANGE` are compatible; `STRONG_BULL` and `BEAR` are conditional; other known trend regimes are incompatible.
- Volatility: normal and low volatility are compatible; high volatility is conditional.
- Risk: `RISK_ON` is compatible; `NEUTRAL` is conditional; `RISK_OFF` is incompatible.
- The repository blueprint does not declare indicator-level prerequisites, so SI.1 does not invent them. Future registry records may supply explicit required and blocking prerequisites.

These rules describe suitability, not expected returns or guaranteed profitability.

## Decision meanings and safety gates

- `ENABLED`: complete, fresh regime evidence is compatible, confidence meets the preferred threshold, required evidence exists, and the existing lifecycle is active and eligible.
- `CONDITIONAL`: suitability is plausible but the regime is partial, confidence is below the preferred threshold, a non-blocking input is missing, compatibility is conditional, or the strategy is validated but not active.
- `DISABLED`: a known regime is incompatible, a blocking prerequisite is missing, lifecycle activation is blocked, validation is invalid, or the strategy is archived, paused, or disabled.
- `UNKNOWN`: the regime is insufficient, invalid, materially stale, contains an unknown classification, or no approved rules exist.

Archived, paused, disabled, or lifecycle-blocked strategies cannot be re-enabled. A stale, invalid, or insufficient regime can never produce `ENABLED`. Existing deterministic risk guardrails retain final authority. AI context is ignored and cannot override a disabled result.

## Confidence

Suitability confidence starts from regime confidence, is clamped to 0–100, and applies centralized penalties:

- 10 points per missing required input;
- 15 points for a partial regime;
- 10 points while a strategy remains in the validated lifecycle rather than active.

The preferred threshold is 70 and the minimum threshold is 50. Thresholds are deterministic review heuristics, not performance claims.

## Read model and data flow

The stable result includes engine and regime versions, overall status, as-of time, symbol, timeframe, compact regime context, per-strategy decisions/confidence/reasons/blockers/missing inputs, summary counts, and explicit paper-only/advisory-only/no-auto-activation boundaries.

The authenticated flow is:

`Strategies route` → `strategy-suitability` Netlify Function → `workspaceDataService.getStrategySuitability()` → one existing market-overview orchestration → adaptive engine → compact read model.

The same market-overview result is reused for every strategy in that evaluation. There is no provider request per strategy, no raw candle response, and no credential exposure. MI.5 cache, deduplication, authentication, request budgets, and provider backoff remain authoritative.

## UI and observability

The Strategies workspace shows regime context, summary counts, decisions, confidence, deterministic reasons, missing evidence, and lifecycle state. Loading, error, empty, partial, and insufficient states are textual and accessible. It adds no activation or trading control.

Diagnostics record engine version, regime status, decision counts, missing-evidence count, and duration. They exclude provider payloads, candles, credentials, and strategy secrets.

## Limitations and future consumers

- The production environment still requires a server-side Twelve Data key for live historical evidence; deterministic fixture validation remains complete without it.
- Atlas has no production-persisted strategy registry exposed to this workspace today. The single supported record remains modeled and human-review-only.
- Intraday strategies are excluded because SI.1 uses the daily regime and no explicit cross-timeframe compatibility rule exists.
- Trade Quality Score may consume this versioned read model only in a separately approved execution order.
