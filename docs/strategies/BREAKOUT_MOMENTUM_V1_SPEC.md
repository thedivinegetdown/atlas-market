# Breakout Momentum V1 Specification

## Identity and lifecycle

- Strategy ID: `breakout-momentum-v1`
- Family: `breakout-momentum`
- Version: `1.0.0`
- Direction: `LONG_ONLY`
- Time horizon: daily swing
- Lifecycle: `PAPER_FORWARD_OBSERVATION`
- Live eligibility: `LIVE_DISABLED`

This strategy evaluates continuation breakouts independently of `index-pullback-v1`. Registration and suitability never authorize live trading or override Trade Quality, risk, sizing, portfolio admission, or canonical plan status.

## Required evidence

Evidence must come from the existing completed daily-candle and daily-indicator authorities. `prior20High` is the highest high across exactly the prior 20 completed daily sessions; an incomplete current session is excluded. The authoritative candidate price must be strictly greater than this level. Equality and prices below the level do not qualify.

`breakoutPercent` is descriptive evidence only:

`(currentPrice - prior20High) / prior20High * 100`

The signal requires all of the following:

- `SMA20 > SMA50 > SMA200`
- `ADX14 >= 20`
- `55 <= RSI14 <= 75`
- `relativeVolume >= 1.20`
- positive existing benchmark-relative-strength evidence

Unavailable, insufficient, or stale required price, indicator, volume, or relative-strength evidence fails closed. The strategy does not create another indicator pipeline or relative-strength formula.

## Market suitability and context

Adaptive Strategy Selection is authoritative for regime suitability. Trend compatibility is enabled for `STRONG_BULL` and `BULL`, conditional for `RANGE`, and incompatible for `BEAR` and `STRONG_BEAR`. Risk compatibility is enabled for `RISK_ON`, conditional for `NEUTRAL`, and incompatible for `RISK_OFF`. `NORMAL_VOLATILITY` and `LOW_VOLATILITY` are enabled; `HIGH_VOLATILITY` is conditional unless an existing safety authority rejects it.

Market Context remains evidence, not a replacement selector. `BROAD_STRENGTH` is supportive; `NARROW_STRENGTH` and `MIXED` are cautionary; `BROAD_WEAKNESS` is incompatible; `INSUFFICIENT_DATA` is unavailable and never supportive. Governed sector mapping may report `LEADING` or `IMPROVING` as supportive, `NEUTRAL` as neutral, and `WEAKENING` or `LAGGING` as cautionary. Without governed mapping, sector alignment is `UNAVAILABLE`; ticker names are not used to infer sectors.

## Entry and invalidation

For a paper candidate, entry is the authoritative current candidate price. A candidate proceeds only after fresh evidence, a qualifying breakout signal, adaptive suitability, Trade Quality, risk, sizing, portfolio admission, and observation policy independently pass. The setup is invalid when its frozen initial stop is reached or its 10 observed-session maximum holding period expires.

## Exit policy

Policy ID: `breakout-momentum-exit-v1.0.0`.

At entry, freeze breakout level, entry price, ATR14, stop, target, policy fingerprint, and strategy fingerprint. Calculate:

- `candidateStopA = breakoutLevel - ATR14`
- `candidateStopB = entryPrice - (2 * ATR14)`
- `initialStop = max(candidateStopA, candidateStopB)`
- `R = entryPrice - initialStop`
- `target = entryPrice + (2 * R)`

The setup is invalid unless `initialStop < entryPrice`. Stops and targets are immutable. The maximum holding period is 10 observed trading sessions. No trailing stops, scaling, partial exits, or discretionary stop/target changes are permitted. If stop and target are touched in one observed bar, the stop is evaluated first. An adverse gap through stop fills at the opening price; a favorable gap through target is capped at the predetermined target. Missing or stale exit evidence fails closed. A PA.4 emergency manual exit is allowed only for safety and is non-policy-compliant for observation outcomes.

## Risk, provenance, and limitations

Existing Trade Quality, risk, position sizing, Qualified Trade Plan, opportunity ranking, and Portfolio Admission remain final authorities. The existing maximum-order-notional policy, quantity semantics, and zero-quantity safety are unchanged; zero quantity is not executable. No strategy-specific quality score, empirical probability, or ranking preference is created.

All outputs retain strategy identity/version/fingerprint, exit fingerprint, evidence freshness and coverage, market-context provenance, and observation identity where applicable. The initial observation universe is `SPY`, `QQQ`, `IWM`, `AAPL`, and `MSFT`; contextual sector ETFs are not candidates. The separate `BREAKOUT.1` observation cohort requires 20 observed trading sessions and 30 policy-compliant outcomes. It remains `NOT_STARTED` until a naturally qualifying candidate passes all existing gates. Strategy or policy changes must not silently merge cohorts. No provider expansion, paid data, automatic optimization, brokerage integration, live execution, or AI authority is included.