# Atlas Market Deterministic Market Regime Engine

Version: `market-regime-v1`

## Purpose

The Market Regime Engine provides a provider-neutral, deterministic description of trend, volatility, and risk conditions. It is a classification foundation for future research and paper-trading consumers; it does not select strategies, score trades, generate orders, or change risk controls.

The reusable entry point is `classifyMarketRegime(input, options)` from `lib/market/regime/index.js`. The compatibility module at `lib/market/marketRegimeClassificationEngine.js` re-exports the same implementation.

MI.2 adds `createMarketRegimeOrchestrator()` as the provider-neutral boundary between approved market observations and the engine. The orchestrator does not fetch data or calculate indicators.

## Orchestration flow and real data sources

The existing read-only `market-overview` Netlify Function validates `symbol` and daily `timeframe`, delegates to `workspaceDataService`, and uses the existing multi-provider `marketDataService` quote path. The service passes the normalized quote into the orchestrator and returns the quote and regime read model in the existing success envelope. The Markets workspace consumes both through the existing API client and `useMarketOverview` hook, so no second provider request is introduced.

The production path currently supplies only current price, provider, symbol, and quote timestamp. Atlas does not currently expose approved production calculations for moving averages, moving-average slope, ADX, normalized ATR/percentile, breadth, VIX, benchmark condition, or relative strength through this endpoint. Those inputs are reported as missing; no placeholders or duplicate calculations are used to force a classification.

### Normalized observation mapping

Each observation carries `value`, `source`, `symbol`, `timeframe`, `observedAt`, optional `receivedAt`, and `derivation` (`provider-supplied` or `calculated`). Aliases are normalized before engine invocation: `sma20/50/200` map to moving averages, `vix` to volatility index, numeric strings to numbers, `atrRatio` to ATR percentage, and `breadthRatio` to breadth percentage. Invalid values are omitted and recorded. Raw provider payloads and credentials are never included.

## Timeframe and freshness rules

The target timeframe is daily (`1D`); `D`, `DAY`, `DAILY`, and `1DAY` normalize to it. Daily indicators must identify a compatible daily timeframe. Realtime quote price is the sole documented compatible derived input for a daily classification. Intraday indicators such as `1H` are omitted with a warning, and unknown timeframes are not silently mixed.

Freshness states are `FRESH`, `STALE`, and `UNKNOWN`. Daily observations are fresh for 36 hours by default; realtime prices are fresh for five minutes. Rules are configurable at the orchestration boundary. Missing or invalid timestamps produce `UNKNOWN`. Stale and unknown-freshness fields remain visible in provenance and coverage but are excluded from engine input. Cache freshness is not separately modeled because MI.2 reuses the uncached, `no-store` market-overview response and adds no cache.

## Read-only contract and UI

The stable read model contains `symbol`, normalized `timeframe`, `asOf`, aggregate `freshness`, `classification`, `inputCoverage`, field-level `provenance`, `warnings`, `engineVersion`, `paperTrading`, and `advisoryOnly`. Coverage distinguishes available, missing, stale, unknown-freshness, invalid, and incompatible fields. It excludes raw provider responses.

The compact Market Regime section presents trend, volatility, risk, confidence, freshness, as-of time, deterministic reasons, and a disclosure for coverage problems. Loading, error, partial, stale, and insufficient-data states use text as well as styling. It contains no trade action, signal language, strategy activation, or performance claim.

## Normalized inputs

The engine accepts already calculated numeric indicators. It does not call providers and does not calculate moving averages, ADX, ATR, or breadth from raw candles.

- Price and short-, medium-, and long-term moving averages
- Moving-average slope percentage
- ADX
- Normalized ATR percentage or ATR percentile
- RSI and relative volume (normalized and reserved for deterministic extension)
- Market breadth percentage
- Volatility index value
- Benchmark change and above-long-average state
- Relative-strength percentage

Input aliases support existing Atlas naming such as `price`, `last`, `sma20`, `sma50`, `sma200`, `normalizedAtr`, `vix`, and `volumeRatio`. Provider identifiers and raw provider payloads are ignored.

## Classifications

Trend returns `STRONG_BULL`, `BULL`, `RANGE`, `BEAR`, `STRONG_BEAR`, or `UNKNOWN`. Price/long-average position, moving-average ordering, slope, relative strength, and ADX contribute deterministic signed points.

Volatility returns `HIGH_VOLATILITY`, `NORMAL_VOLATILITY`, `LOW_VOLATILITY`, or `UNKNOWN`. ATR percentile, normalized ATR, and volatility-index evidence are normalized to a 0–100 score.

Risk returns `RISK_ON`, `NEUTRAL`, `RISK_OFF`, or `UNKNOWN`. Breadth, volatility index, benchmark condition, relative strength, and the deterministic trend score contribute normalized evidence.

All thresholds are centralized in `regimeConfig.js` and may be overridden through `options.config`. Defaults are classification heuristics, not guarantees of performance.

## Confidence and status

Confidence is an integer from 0 to 100 based on evidence coverage and score separation. Missing expected inputs and invalid inputs apply bounded penalties. `PARTIAL`, `INVALID_INPUT`, and `INSUFFICIENT_DATA` results have confidence caps.

Statuses are:

- `COMPLETE`: all three categories have sufficient evidence.
- `PARTIAL`: one or two categories have sufficient evidence.
- `INSUFFICIENT_DATA`: no category has its minimum evidence.
- `INVALID_INPUT`: at least one supplied recognized field is malformed or outside its accepted range; valid remaining evidence is still reported safely.

The default result has no timestamp, so identical inputs and configuration produce stable serialized output. Callers may explicitly provide `options.timestamp` when an evaluated timestamp is required.

## Missing and invalid data

Missing optional fields do not throw and do not produce reasons for absent evidence. A category returns `UNKNOWN` until its minimum evidence is present. Malformed recognized values are omitted consistently and listed in `invalidInputs`. Expected confidence inputs that are absent appear in `missingInputs`.

## Intended downstream consumers

Future, separately approved phases may consume the result for adaptive strategy selection, trade-quality scoring, briefings, paper-trading automation, or risk-aware opportunity ranking. MI.1 does not implement or integrate those behaviors.

MI.2 still excludes adaptive strategy selection, scanner ranking, trade-quality scoring, order or portfolio effects, AI input repair, and additional provider fetching. Additional calculated observations can be attached later through the same orchestration contract after an approved data path exists.

## MI.3 deterministic daily indicator pipeline

MI.3 adds the provider-neutral `lib/market/indicators/` pipeline. Its approved historical-data path is `marketDataService.getCandles(symbol, { interval: '1d', limit: 260 })`, which remains behind the existing provider registry, capability selection, normalization, and fallback behavior. The pipeline requests the symbol, the established configurable benchmark (`SPY` by default), and the existing market-session status server-side. When the symbol is SPY, its candle request is reused as the benchmark request.

The current default provider implementation exposes only a one-candle quote-derived fallback through its candle capability. That is not treated as historical evidence: the pipeline reports unavailable long-window indicators and MI.2 remains insufficient. Providers or injected approved services that return complete daily history can populate the same contract without changing the regime engine or UI.

### Normalized candle contract

Daily candles contain `timestamp`, `open`, `high`, `low`, `close`, `volume`, `symbol`, `timeframe: 1D`, `source`, and `completed`. Normalization:

- orders valid records oldest to newest;
- resolves duplicate timestamps by retaining the last normalized source record;
- rejects invalid timestamps, non-positive OHLC values, inconsistent high/low bounds, and negative volume;
- excludes explicitly incomplete candles;
- excludes a candle dated today while the existing market-status path reports the regular session open;
- preserves provider source without retaining raw provider payloads.

Malformed and incomplete records appear in structured coverage and warnings. Calculations never use a single quote as a substitute for a historical series.

### Indicator definitions and minimum history

Windows are centralized in `indicatorConfig.js`.

| Indicator | Definition | Minimum completed candles |
| --- | --- | ---: |
| SMA 20 / 50 / 200 | Arithmetic mean of the latest closing prices | 20 / 50 / 200 |
| Short and medium SMA slope | Percentage change in the SMA over five SMA observations | 25 / 55 |
| ATR 14 | Wilder-smoothed true range | 15 |
| ATR percentage | Latest ATR divided by latest completed close, multiplied by 100 | 15 |
| ATR percentile | Percent-rank of the latest ATR within 100 ATR observations | 114 |
| ADX 14 | Wilder directional movement, DI, DX, then Wilder ADX | 28 |
| RSI 14 | Wilder-smoothed gains and losses | 15 |
| Relative volume | Latest completed volume divided by the prior 20-candle average | 21 |
| Benchmark condition | Benchmark close above its SMA 200 plus its 20-session return | 200 for long-average condition; 21 for return |
| Relative strength | Symbol 20-session return minus benchmark 20-session return, aligned by trading date | 21 aligned observations |

Zero historical average volume, inadequate warm-up, and inadequate benchmark overlap return missing values. Breadth, VIX, sector breadth, and advance/decline data remain absent because no trustworthy approved source exists.

### Daily indicator bundle and provenance

`buildDailyIndicatorBundle()` returns a stable serializable `daily-indicators-v1` bundle containing the symbol, `1D` timeframe, latest completed as-of time, normalized indicators, available/missing/invalid coverage, warnings, and field-level provenance. Provenance records provider source, symbol, optional benchmark, timeframe, observation time, calculation time, calculation name/window, derivation, and source-candle count. Full candle arrays and credentials are not exposed in the bundle.

MI.2 converts bundle fields into its observation contract and applies its existing freshness and timeframe checks before invoking MI.1. A realtime quote can still override the bundle’s latest close as current price. Indicator calculation remains outside React, order execution, strategies, scanners, AI, portfolios, risk controls, and persistence.

### MI.3 limitations

- Production classification only improves when the configured provider actually returns sufficient completed daily history.
- Calendar-date alignment is deterministic but does not independently validate exchange holidays.
- Prices are unadjusted unless the existing provider supplies adjusted candles under the same contract; splits and dividends can therefore affect long-window calculations.
- The serverless request currently performs one symbol candle request, at most one distinct benchmark candle request, and one market-status request. No new cache or dependency was introduced.

## Boundaries and limitations

- Provider-neutral: no provider calls, credentials, or raw payload logging.
- Deterministic: no AI, LLM, randomness, or hidden state.
- Paper/advisory only: no orders, fills, position mutation, execution, or guaranteed recommendation.
- Risk controls remain authoritative and unchanged.
- Classification quality depends on the quality, freshness, timeframe consistency, and representativeness of normalized inputs.
- Thresholds require future empirical review and do not predict returns.
