# Atlas Market Forward-Test Evidence Baseline

Status: EDGE.1 contract established for paper-only forward observation.

## Purpose

Atlas records a compact, deterministic evidence snapshot before an opportunity can enter forward paper evaluation. The snapshot describes the evidence available at that moment; it does not optimize a strategy, alter Trade Quality weights, change risk formulas, or authorize execution.

The bounded EDGE.1 verification universe is `SPY`, `QQQ`, `IWM`, `AAPL`, and `MSFT`.

## Production data path

The approved server-side path remains:

`Finnhub quote -> Twelve Data quote -> explicit mock quote fallback`

Daily historical evidence uses Twelve Data only. Atlas requests exactly 260 `1day` candles. Incomplete responses remain visibly truncated, and provider failure returns unavailable evidence. Finnhub premium history and synthetic candle generation are not fallback options.

`TWELVEDATA_API_KEY` is read only by server-side Functions. No `VITE_*` provider credential is supported. Provider payloads, request URLs, keys, and raw candles are excluded from evidence records and API responses.

## Evidence record

`forward-test-evidence-v1` contains only:

- symbol and evidence timestamp;
- regime state and confidence;
- strategy ID, suitability decision, and suitability confidence;
- Trade Quality score, band, confidence, and evidence status;
- compact opportunity/scanner/reference-price context;
- normalized provider, freshness/status, observation time, and fallback state;
- missing evidence, stable blockers, readiness, and eligibility;
- paper-only and no-automatic-execution boundaries.

The record is returned alongside Trade Quality evidence. It does not create a second ledger or persist raw market data.

## Readiness states

- `REAL_DATA_READY`: live, complete provider evidence satisfies the market, regime, strategy, and Trade Quality evidence gates.
- `DEGRADED`: real provider evidence is delayed/degraded or otherwise qualified. Its exact provenance remains visible.
- `MOCK`: any mock provider or mock flag. Mock evidence can never become real-data ready.
- `INSUFFICIENT_DATA`: required provider, regime, strategy, or Trade Quality evidence is missing.

No additional UI panel is required for EDGE.1 because the existing Market Overview, Market Regime, Strategy Suitability, and Trade Quality panels already expose provenance, freshness, confidence, missing evidence, and blockers. The additive API record provides the canonical machine-readable summary.

## Forward paper eligibility

Eligibility fails closed unless all of the following are true:

1. The symbol is in the bounded EDGE.1 universe.
2. Provider evidence is real and is not `MOCK`, `STALE`, `UNAVAILABLE`, or `UNKNOWN`.
3. The regime classification is `COMPLETE`.
4. The selected existing strategy is `ENABLED` by the suitability engine.
5. Trade Quality has a numeric score, sufficient coverage, and no blocking reason.
6. Existing risk gates were evaluated and passed.

`DEGRADED` real-provider evidence remains labeled `DEGRADED`; it may satisfy the narrow non-mock/fresh evidence rule, but it is never relabeled `LIVE` or `REAL_DATA_READY`. The existing paper-evaluation and execution gates remain authoritative.

## Cost and execution boundaries

Twelve Data Basic currently permits 8 API credits per minute and 800 per day. Atlas retains conservative process-local historical limits of 6 per minute and 720 per day. The five-symbol verification uses at most five historical and five quote credits when executed in bounded, rate-aware batches. Process-local limits do not constitute a global multi-instance provider quota.

EDGE.1 does not add a provider, subscription, paid tier, broker, live-trading path, automatic paper execution, strategy, scoring-weight change, or risk-formula change.
