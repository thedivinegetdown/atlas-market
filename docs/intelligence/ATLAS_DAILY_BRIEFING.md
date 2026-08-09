# Atlas Daily Briefing and Command Center Intelligence

Version: `daily-briefing-v1`

## Purpose and boundaries

DB.1 provides one concise, deterministic operator view over existing Atlas intelligence. It aggregates facts and existing read models; it does not create another market, strategy, opportunity, portfolio, or risk scoring engine. The briefing is advisory-only and paper-trading-only. It cannot change scanner order, strategy lifecycle, portfolios, risk controls, or execution state.

The provider-neutral entry point is:

```js
buildDailyBriefing({ regime, strategySuitability, opportunities, portfolioRisk, alerts, operations })
```

The engine has no provider, persistence, AI, order, or portfolio dependencies.

## Data sources and aggregation flow

| Briefing section | Existing source | DB.1 behavior |
| --- | --- | --- |
| Market Environment | MI.1–MI.5 regime read model | Preserves trend, volatility, risk regime, confidence, status, freshness, and as-of time |
| Strategy Environment | SI.1 suitability read model | Preserves decision counts, strategy decisions, and suitability confidence |
| Opportunity Review | Bounded, already-reviewed TQ.1 read models | Includes at most three compact results; does not evaluate scanner matches automatically |
| Portfolio and Risk | Existing portfolio summary | Preserves account value, open risk, drawdown, risk tier, and warnings when available |
| Alerts and Operations | Existing alerts plus health on the already-resolved market quote | Summarizes open and critical alerts and provider degradation without another provider request |

The authenticated production flow is:

`Dashboard route` → `daily-briefing` Netlify Function → `workspaceDataService.getDailyBriefing()` → one historical market overview plus local portfolio and alert reads → SI.1 from the same regime object → deterministic briefing engine → compact Dashboard read model.

Historical candles are requested once through the existing MI.5-guarded market-overview path. The regime is reused for SI.1. DB.1 does not invoke TQ.1 for every scanner result, request data per strategy, poll in the background, or expose raw candles or provider credentials.

## Status model

- `READY`: core market, strategy, and portfolio evidence is complete and fresh, with no elevated review priority.
- `CAUTION`: evidence is usable but partial, a provider is degraded, or a high/medium review item exists.
- `BLOCKED`: a critical alert, invalid or materially stale market evidence, or severe portfolio risk requires review first.
- `INSUFFICIENT_DATA`: a core market, strategy, or portfolio read model is unavailable.
- `ERROR`: reserved for a failed briefing orchestration response. Transport failures are shown by the Dashboard error state rather than fabricated as a briefing.

`READY` is never returned for stale, invalid, or missing critical evidence.

## Priority model

Rules and thresholds are centralized in `lib/intelligence/briefing/dailyBriefingConfig.js`. Priorities are sorted deterministically by severity and stable identifier, then capped at five.

- `CRITICAL`: critical alert, invalid/stale critical regime evidence, or drawdown at or above 20%.
- `HIGH`: risk-off environment, degraded provider, high-severity alert, reviewed TQ.1 result at or above 80, drawdown at or above 10%, or concentration at or above 40%.
- `MEDIUM`: partial market evidence, conditional strategy suitability, caution alert, or a reviewed opportunity at or above 55.
- `LOW`: informational open alert requiring routine review.
- `INFORMATIONAL`: healthy summary when no elevated item exists.

Priority text is human-review guidance only. Prohibited execution or guaranteed-performance language is excluded from externally supplied alert, opportunity, strategy, and portfolio text.

## Freshness, coverage, and provenance

The briefing retains the regime as-of time and freshness rather than creating a new market timestamp. Coverage flags separately identify market, strategy, opportunity, portfolio, and operations evidence. Missing fields remain unavailable and generate concise warnings; DB.1 never creates placeholder values.

The existing portfolio summary does not currently expose concentration. DB.1 reports it as unavailable instead of estimating it. Likewise, TQ.1 review results are currently transient and not persisted, so the production briefing shows an empty opportunity section until a separately approved bounded read path exists.

Diagnostics record briefing version, top-level status, priority count, warning count, and duration. They exclude raw candidates, provider payloads, candles, secrets, and credentials.

## Dashboard presentation

The Dashboard Command Center displays briefing status, regime and freshness, strategy counts, open risk and drawdown, critical-alert count, up to five priority actions, bounded reviewed opportunities, and coverage warnings. It includes accessible loading, error, insufficient, caution, and ready states. No execution or automatic-action control is present.

The Dashboard route remains lazy-loaded. Other workspaces do not import or request the briefing.

## Limitations and future scope

- Live historical verification remains dependent on the already-configured server-side Twelve Data key. DB.1 adds no provider or paid capability.
- Current production opportunity review does not persist TQ.1 results, so opportunity aggregation is empty by default.
- Portfolio concentration is absent from the existing summary contract.
- Broader runtime health exists across specialized endpoints; DB.1 conservatively uses the already-resolved quote health to avoid another provider request.
- Optional Atlas Copilot narrative summarization remains future scope. The core briefing will remain deterministic and must never rely on AI availability or fabricate facts.
