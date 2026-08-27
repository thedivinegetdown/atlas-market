# Range Mean Reversion v1

`range-mean-reversion-v1` is a daily, long-only paper-forward-observation strategy for statistically stretched prices in non-trending markets. It is not a trend-pullback or breakout strategy and can always return no trade.

Required fresh evidence is the authoritative candidate price, exactly 20 prior completed daily candles, existing SMA20, ATR14, ADX14, and RSI14. Entry requires price strictly above the prior 20-session low, stretch `(SMA20 - price) / ATR14` of at least 0.75, RSI14 in [30, 40], and ADX14 below 20. ADX14 from 20 through 25 is conditional; ADX14 above 25 is incompatible. RANGE and RISK_ON are preferred; BULL and STRONG_BULL are conditional; BEAR, STRONG_BEAR, RISK_OFF, and broad market weakness are incompatible.

Relative volume at or below 1.50 is supportive, above 1.50 is cautionary, and at or above 2.00 is incompatible. Relative strength is descriptive and may add caution but is not an entry gate. Sector evidence remains explicit when unavailable.

The fixed `range-mean-reversion-exit-v1.0.0` policy freezes entry, prior20Low, SMA20, ATR14, stop, and target. Stop is `max(prior20Low - 0.50 * ATR14, entryPrice - 1.50 * ATR14)`. Target is the entry-time SMA20 and must exceed entry with at least 1.25R. There are no trailing stops, scaling, partial exits, or discretionary amendments. The maximum hold is 10 sessions; same-bar stop/target ambiguity is stop-first; adverse gaps fill at open and favorable target gaps cap at target. Stale exit evidence fails closed. Emergency manual closes are non-policy-compliant and excluded from cohort minimums.

RANGE.1 observes SPY, QQQ, IWM, AAPL, and MSFT independently from EDGE.2 and BREAKOUT.1, requiring 20 observed sessions and 30 policy-compliant completed outcomes. Live trading is disabled, and no empirical confidence or probability is produced.