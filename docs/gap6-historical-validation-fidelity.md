# Gap 6: historical-validation fidelity

Audited base: `bdcddb709e848c914eff910fbcba5024fc2c06e4`.
Disposition: **PARTIAL_CAPABILITY**. Unsafe historical evidence generation is
disabled. Canonical paper-outcome resampling is supported; trustworthy historical
strategy execution and independently executed OOS windows are not available.
This is local source/test evidence, not production acceptance.

## Proven causes at the audited base

| Hypothesis | Evidence | Finding |
| --- | --- | --- |
| Reused future context | `strategyBacktestExecutionEngine.runCandleStep` passed the same input research context, research score, AI decision, regime, risk, sizing and multitimeframe objects to every candle's rules and signal composition. Only the output timestamp changed. | Confirmed: no as-of validation or prefix recomputation. The caller could supply later context to earlier decisions. |
| Same-candle execution | `buildProposedTrade` used `candle.close`; `buildQuoteFromCandle` used that close for bid/ask/last; execution, accounting and journal all used the signal candle timestamp. | Confirmed: no subsequent executable market event. |
| Generic strategy semantics | `buildProposedTrade` synthesized a 2% stop; both branches of exit direction selected `sell`. No frozen entry-to-exit policy was invoked. | Confirmed: blueprint compatibility did not establish canonical strategy/policy semantics. |
| Walk-forward fallback | `getWindowPerformanceSummary` fell back to whole-run metrics/return curve; `attachWindowReferences` fell back to the whole-run session. The engine never executed a window. | Confirmed: repeated aggregate evidence could produce `robust`. Supplied window summaries were also unverified. |
| Synthetic Monte Carlo outcomes | `getTradeOutcomes` used equity differences or reconstructed wins/losses from trade count, win rate and average win/loss, dropping zeros. Empty input still generated flat paths. | Confirmed: neither path required canonical closed lifecycles. |
| Unfrozen assumptions | Input builder captured current risk and a selected universe, without its selection time. Replay normalized/sorted all candles, defaulted fields, and used wall-clock staleness. No immutable data vintage, action ledger or historical configuration fingerprint existed. | Confirmed. Costs were deterministic simulator defaults, but not explicit frozen run inputs. |

Performance analytics additionally accepted injected snapshots and legacy journal
fills as historical performance. Reporting converted missing numbers to zero,
could describe absent drawdown evidence as controlled, and could approve legacy
`robust` summaries. Those historical promotion paths are now closed.

## Path and timing audit

| Path | Information and timestamps | Execution / outcome | Fingerprints and boundaries |
| --- | --- | --- | --- |
| Backtest input builder | Caller-selected current strategy/universe/risk; no selection/availability time. Date range is requested configuration, not a provider snapshot. | Configuration preparation only; historical evidence explicitly `UNAVAILABLE`, even if configuration readiness is `ready`. | No invented data/universe/policy fingerprints. |
| Historical replay | Caller candle array normalized and sorted; candle timestamps are labels. Full-array quality and next timestamp are visible for presentation. | Presentation only, explicitly not decision evidence. No signal or fill. | No immutable vintage or corporate-action entitlement. Future changes can affect presentation metadata; it is not a prefix-proof engine. |
| Daily indicator pipeline / bundle | Latest 260 candles for symbol and benchmark. Bundle calculates from supplied completed candles. It is not a historical as-of data adapter. Current-day filtering is not a general future-data filter. | Current advisory context; never reused by the repaired historical executor. | Indicator pipeline version exists, but provider vintage and point-in-time universe do not. No historical training/test boundary. |
| Research score/context, rule evaluator, signal composer | Caller-supplied current context; output timestamp is not an input-availability proof. | Existing current advisory behavior preserved. Historical execution no longer invokes these functions. | No historical point-in-time contract; no claim that these are historical features. |
| Historical execution | No supported historical decision-time context. | `blocked` plus evidence `UNAVAILABLE`; no rules, signals, fills, accounting mutations or canonical outcomes. Signal/fill timestamp and price are null. | All strategies rejected regardless of caller availability flags or policy objects. |
| Historical performance / report | Legacy snapshots are not accepted as new historical evidence. | Metrics/return curves unavailable; no strengths or approval from missing/legacy evidence. | Cannot upgrade old stored results through the public report API. |
| Walk-forward | Ordered, unique timestamp labels support planning boundaries only. | Plans marked `NOT_EXECUTED`; no execution references, window results, scores or degradation claims. | Strict chronological train/test separation and nonoverlapping test windows; neither whole-run nor supplied aggregates count as window evidence. |
| Monte Carlo | Complete scoped canonical execution history, explicit outcome cutoff; every source execution must be known by that cutoff. | Existing Gap 3 builder supplies reconciled closed lifecycles. Seeded bootstrap samples their net cash outcomes; no market orders or historical decisions. | Single account and cohort, recorded strategy/policy attribution, source/configuration checksums. No train/test or historical-universe claim. |

The production Twelve Data adapter explicitly requests `adjust=splits`, exactly
260 latest daily bars, and rejects custom start/end/range requests.
`historicalCandleNormalizer` converts dates to midnight UTC labels and retains
the last duplicate provider row. These labels do not identify exchange open,
close, decision availability, or earliest execution. Split adjustment can revise
earlier prices. Neither historical dividend accounting nor versioned
corporate-action evidence is exposed to the backtest contract.

Existing forward exit policy implementations are not a historical execution
adapter. In particular, the existence of BREAKOUT/RANGE/VOL forward policy files
does not resolve the user's gated canonical execution/policy contracts.
`index-pullback-v1` has an existing frozen exit policy, but lacks the required
point-in-time historical entry/context/data/session contract here. None is
replaced by a generic stop or an invented next-open model. EDGE.2 remains manual
and evidence collection is untouched.

## Smallest supported evidence contract

`historical-evidence-v1` exposes capability failure independently of legacy
event/status names. The unavailable contract lists the missing historical
strategy adapter, point-in-time context, executable session timestamps, immutable
data vintage, point-in-time universe, corporate-action accounting and cost model.
It reports unknown evidence fields as null, not successful zero performance.
Caller-supplied availability flags cannot enable an implementation that does not
exist. Input and replay remain useful as configuration/presentation only.

Re-enabling historical execution requires an actually supported frozen adapter
and market evidence. Each decision must recompute features from only inputs
available at its decision time, including benchmark/research/risk/state inputs.
The signal time must follow completion/availability of those inputs; entry must
use the first subsequent executable price allowed by that strategy and venue
contract. The policy must define stop/target gaps, ambiguity, holding time and
exit execution. No same-bar or next-day price can be inferred from date labels.
These are requirements, not capabilities implemented by this repair.

Each OOS window would need fresh portfolio/execution state, its own execution
identity and canonical outcomes, frozen pre-test configuration, and a provable
training cutoff. Training candles could supply permitted warm-up features, but
training trades/outcomes cannot count as OOS. No such executor exists, so this
repair does not fabricate window results or optimize parameters.

## Canonical Monte Carlo contract

`simulateMonteCarloStrategy` accepts `canonicalExecutionHistory` in the shape of
the existing, tenant-scoped ledger `readExecutionHistory` result, plus explicit
`startingEquity` and `outcomeCutoff`. This is an internal pure analytics API, not
a new authenticated route or a ledger reader. Its caller must obtain rows from
the existing authorized scoped repository. No new data access or tenant query
is introduced. A checksum does not authenticate caller-provided data.

History must be `COMPLETE`, with no earlier rows omitted and a matching row
count. Rows require unique execution IDs, one account record/account pair,
position/strategy/symbol identity, paper-only status, engine version, valid
execution/record timestamps, positive quantity/fill price, and explicit finite
cash impact, realized delta, fees and slippage. Both timestamps must be at or
before the explicit cutoff. Windowed, malformed or future evidence is rejected.

The unchanged `buildCanonicalPaperOutcomes` supplies one outcome per completed
lifecycle. Entry/reduction rows are not separate samples. Open lifecycles are
reported as excluded. Closed outcomes require complete immutable attribution,
reconciled quantities/P&L, ordered execution evidence and a close after entry.
Mixed accounts/cohorts, duplicates and invalid closed outcomes return
`UNAVAILABLE`; the engine does not silently cherry-pick usable closed rows.
The minimum sample remains the existing review minimum of **5**.

All net outcomes are retained, including zero. Recorded entry/exit fees and
slippage embedded in fill prices are consumed once through canonical net cash
P&L. Missing costs are never assigned zero. This is additive resampling of
recorded paper outcomes, not reconstructed gross trades, a price simulation,
an independence proof, a performance forecast, or historical strategy approval.

Defaults for seed (42), paths (100), and drawdown threshold (10, with existing
drawdown-protection precedence) remain explicit in returned configuration.
Capital, cutoff, actual seed, path/trade counts, threshold and source checksum
are frozen in the configuration checksum. Outcome rows are sorted by close
time/ID; object keys are canonicalized. Recorded execution versions, attribution,
fees/slippage and economic values enter the source checksum. Reordering input
keys/rows leaves outputs unchanged. The checksum follows the existing policy
fingerprint approach and is a reproducibility aid, not a cryptographic signature.

Available resampling explicitly reports
`historicalValidationStatus: UNAVAILABLE`. Legacy `robust` walk-forward labels
cannot upgrade it. Insufficient evidence returns no curves, no probabilities,
no confidence interval and no successful zero-valued risk claim.

## Controlled proof matrix

| Required case | Local controlled result / limit |
| --- | --- |
| Future-candle mutation | Mutating future prices/volume and shared context leaves earlier decision/fill arrays empty and the rejection unchanged. **Rejection invariance only; successful prefix execution remains unavailable.** |
| Signal to next executable fill | Same-candle and invented next-open execution are prevented. Timestamp/price remain null. **No successful next-fill proof without session/market evidence.** |
| Train/test separation | Plans enforce ordered unique timestamps, disjoint training/test bounds and nonoverlapping test windows. |
| Independent OOS runs | No executor exists; plans never acquire execution references/results. **Unavailable, not proven successful.** |
| No aggregate fallback | Whole-run metrics and caller window summaries produce no window scores/results; legacy reports cannot approve. |
| Canonical-only Monte Carlo | Samples only Gap 3 closed net outcomes, retains zero, rejects aggregate/equity/raw-outcome alternatives, and excludes open reductions. |
| Insufficient data | Empty/subminimum samples, omitted/truncated history, missing costs/versions, invalid chronology, duplicate IDs, mixed accounts/cohorts and unreconciled records fail closed. |
| Explicit costs | Recorded fees/slippage required; reconciled fee change changes net outcome exactly once. |
| Reproducibility | Fixed cutoff, source and seed reproduce output; reordered rows/keys reproduce output; changed source cost or seed changes the corresponding fingerprint. Historical data/universe fingerprints remain null. |
| Unsupported policy | BREAKOUT.1/RANGE.1/VOL.1/EDGE.2, their strategy IDs, index pullback and unknown strategies cannot bypass the unavailable historical adapter. |

## Validation and boundaries

Validation on Node `v22.14.0` / npm `10.9.2`:

- Final targeted run: **8 files, 75 tests passed** (execution, performance,
  walk-forward, Monte Carlo, report, input builder, replay and frozen Gap 3).
- Targeted lint: passed without warnings; `git diff --check`: passed.
- `npm run ci:verify`: **passed** configuration validation, API-control inventory,
  full test suite, lint, production build and performance budget. Lint warnings:
  **23 / 26** baseline; no build warning. Migration, sensitive-material and
  generated-artifact scans passed.
- CI ran in the supplied dirty working tree. Pre-existing unrelated edits were
  neither repaired nor included in the Gap 6 commit. No isolated clean-checkout
  or production acceptance is claimed.

The controlled fixtures are synthetic test inputs only, never production market
evidence. No strategy/TQ/risk thresholds, frozen policies, PA.4 provider work,
INTEL.6, execution/exit permissions, Save Review, provider pacing, observation,
claim/recovery behavior or live trading settings were changed. Existing unrelated
working-tree edits are excluded from this commit. No push or deployment.

Full Gap 6 acceptance is blocked on the missing historical evidence/contracts
above and subsequent production proof of any enabled implementation. Source,
tests, lint, build and CI cannot establish that proof.

## Changed files

- `src/core/strategy/historicalEvidenceContract.js`
- `src/core/strategy/canonicalMonteCarloEvidence.js`
- `src/core/strategy/strategyBacktestInputBuilder.js`
- `src/core/strategy/strategyBacktestExecutionEngine.js` and its test
- `src/core/strategy/strategyBacktestPerformanceAnalyticsEngine.js` and its test
- `src/core/strategy/strategyBacktestReportGenerator.js` and its test
- `src/core/strategy/strategyWalkForwardTestingEngine.js` and its test
- `src/core/strategy/strategyMonteCarloSimulationEngine.js` and its test
- `lib/market/historicalMarketReplayEngine.js`
- `src/workspaces/Backtesting/backtestSections.jsx`
- `tests/fixtures/gap6CanonicalHistory.js`
- This audit document
