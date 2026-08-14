# Market Data Provenance and Degraded-State Safety

## Canonical contract

Atlas uses one compact market-data provenance object on market-derived read models:

| State | Operator meaning |
| --- | --- |
| `LIVE` | A named non-mock provider supplied an observation inside the existing freshness window. |
| `DELAYED` | The provider/result explicitly identifies delayed data. |
| `STALE` | The observation exceeds the existing 90-second quote freshness rule. |
| `DEGRADED` | A non-primary fallback supplied the result or the result is explicitly degraded. |
| `MOCK` | Deterministic development/demo data. It is never live market information. |
| `UNAVAILABLE` | No usable market result is available. |
| `UNKNOWN` | Provenance is missing or cannot support a stronger claim. Atlas does not infer live status. |

The safe fields are `provider`, `dataStatus`, `observedAt`, `receivedAt`, `freshness`, `fallbackUsed`, `mock`, `delayed`, `warningCodes`, and `sourceCount`. Credentials, API keys, provider payloads, and internal URLs are excluded.

## Existing provider and fallback policy

The existing default quote path remains Finnhub, then Twelve Data, then the deterministic mock provider. No provider request, provider contract, entitlement, billing setting, or paid service was added. A Twelve Data quote used after Finnhub is `DEGRADED`; the deterministic fallback is always `MOCK`, with degraded health and explicit fallback warnings. A failed provider result is `UNAVAILABLE` and unknown legacy data remains `UNKNOWN`.

Historical daily candles continue to fail closed when genuine Twelve Data history is unavailable. Synthetic historical fallback remains prohibited.

## Freshness and propagation

Quote freshness continues to use the established 90-second rule. Status trust is monotonic: mock, stale, unavailable, or degraded input cannot become `LIVE` downstream. Provenance is carried through Market Regime, Adaptive Strategy Suitability, Trade Quality, Daily Briefing, scanner results, and paper evaluation without changing formulas, weights, thresholds, ordering, risk controls, or paper-only behavior.

Daily Briefing and paper evaluation qualify guidance derived from non-live evidence. Portfolio prices without a connected quote provenance contract display `UNKNOWN`; they are not relabeled as live.

## UI and operator interpretation

The reusable market-data status treatment supplies a text label, provider, as-of time, and an accessible status. It is used by Dashboard/Command Center, Markets, Watchlist, Scanner, Portfolio price surfaces, and Research through shared panels. `MOCK DATA` includes “Development/demo data — not live market information.” Color is supplementary only.

Operators must treat `MOCK`, `STALE`, `DEGRADED`, `UNAVAILABLE`, and `UNKNOWN` as qualified evidence. These states are suitable for bounded paper/demo review only and are not proof of production-quality real-time data.

## Known limitations

- Provider credentials, exchange entitlements, delay flags, quotas, and production freshness remain deployment facts.
- Finnhub and Twelve Data do not currently provide a uniform explicit delayed-data flag on every quote response; Atlas reports `DELAYED` only when known.
- The deterministic mock fallback remains enabled for development/demo continuity and is therefore prominently labeled.
- Portfolio repository reference prices do not yet carry quote-level provider provenance and display `UNKNOWN`.
- Process-local cache, budget, and diagnostics state do not span serverless instances.
- No external telemetry service or additional provider was introduced; quote-resolution logs use existing safe logging conventions.
