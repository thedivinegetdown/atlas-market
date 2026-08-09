# Paper Performance Review

Version: `paper-performance-review-v1`

PA.3 is a deterministic, read-only review of completed simulated paper outcomes. It extends Atlas's existing paper-performance analytics and reads tenant/user-scoped compact simulation history. It creates no ledger, migration, provider request, order, or background process.

## Eligible records and exclusions

A completed record must be paper-only, have a simulated fill, have an accounting state of `position_closed` or `position_reduced`, and contain an explicit numeric realized P&L delta. Opening fills, open positions, rejected or non-filled simulations, duplicates, stale/incomplete records, and records without realized linkage are excluded and counted by state. Exit prices and P&L are never fabricated.

PA.2 now retains compact Trade Quality, regime, evaluation, accounting-state, and realized-P&L linkage for future reproducible review. Existing PA.2 opening fills remain incomplete until a genuine closing lifecycle exists.

## Formulas and samples

The engine reuses `evaluatePaperPerformance` for realized trade statistics and `equityCurveEngine` for maximum drawdown. It additionally calculates losses/breakeven, gross result, win/loss ratio, streaks, average drawdown, recovery factor, trade-return mean and volatility, and non-annualized Sharpe-/Sortino-style ratios only with at least five explicit return observations.

Sample maturity is centralized: fewer than 5 `INSUFFICIENT_SAMPLE`, 5–19 `EARLY`, 20–49 `DEVELOPING`, and 50+ `ESTABLISHED`. Groups smaller than three disclose only their sample count. Status considers sample maturity, completeness, expectancy, profit factor, drawdown, and recent trend; it never claims future reliability.

The last ten completed trades are compared with the preceding sample using conservative centralized expectancy thresholds. Results are `IMPROVING`, `STABLE`, `DETERIORATING`, or `INSUFFICIENT_DATA`.

## Validation feedback

Breakdowns cover strategy, Trade Quality band/range, trend/volatility/risk regime, PA.1 status, symbol, asset type, and month where linkage exists. Feedback is deterministic and advisory. It may identify insufficient samples, positive expectancy with controlled drawdown, elevated drawdown, or recent deterioration. It cannot edit SI.1 rules, TQ.1 weights, MI thresholds, risk limits, scanner ranking, or execution.

The Reports workspace exposes a compact authenticated review with explicit paper-only and advisory-only boundaries. Dashboard integration remains out of scope to avoid unnecessary density.

PA.4 [paper position exits](./PAPER_POSITION_EXIT_LIFECYCLE.md) provide the genuine closing/reducing lifecycle records consumed by this review.

PA.5 derives the read-only [Paper Learning and Evidence Dashboard](./PAPER_LEARNING_EVIDENCE.md) from this bounded read model without changing these formulas.
