# Paper Learning and Evidence Dashboard

Version: `paper-learning-v1`

PA.5 is a thin deterministic interpretation layer over PA.3. It consumes PA.3 sample maturity, realized metrics, quality groups, strategy groups, regime groups, symbols, asset types, periods, coverage, and recent trend. It does not recalculate trade P&L or introduce another performance engine.

## Evidence and sample discipline

Every evidence item retains its realized sample count and PA.3 maturity. Groups suppressed by PA.3 remain `INSUFFICIENT_SAMPLE`; PA.5 never restores hidden metrics or assigns strong labels to tiny samples. Materially unequal calibration samples are disclosed and marked `UNSTABLE` rather than compared as though balanced.

Strategy evidence is descriptive: `INSUFFICIENT_SAMPLE`, `PROMISING`, `STABLE`, `CAUTION`, or `DEGRADED`. These are not SI.1 lifecycle or activation states. They consider only the PA.3 sample maturity, expectancy, and profit factor. Cross-dimensional best/weakest regime by strategy is not inferred because the current bounded PA.3 read model does not expose a sufficiently mature cross-tab.

Regime evidence preserves trend, volatility, and risk groups with sample count, maturity, and PA.3 metrics. Symbol, asset-type, and monthly evidence remain bounded PA.3 projections.

## Trade Quality calibration

Bands are ordered `WEAK`, `WATCH`, `QUALIFIED`, `STRONG`, `EXCEPTIONAL`. Only bands with at least five realized outcomes participate. Fewer than two eligible bands is `INSUFFICIENT_DATA`; sample ratios above 3:1 are `UNSTABLE`; non-decreasing expectancy is `CONSISTENT`; decreasing expectancy is `INVERTED`; other patterns are `MIXED`. This is correlation evidence, never causation, and TQ.1 weights are not modified.

## Review actions and boundaries

Bounded prompts are `CONTINUE_OBSERVATION`, `REVIEW_STRATEGY_EVIDENCE`, `REVIEW_QUALITY_CALIBRATION`, `REVIEW_REGIME_PERFORMANCE`, and `INSUFFICIENT_EVIDENCE`. They require human review and cause no mutation.

The Reports workspace presents overall maturity, PA.3 status, calibration, strategy and regime evidence, recent trend, observations, and review actions. No Dashboard integration was added, so the endpoint creates no extra provider work. PA.4 remains the source of genuine realized exits. There are no AI conclusions, external analytics, strategy optimization, scoring changes, regime changes, risk changes, orders, or background workers.
